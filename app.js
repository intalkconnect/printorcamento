const express = require('express');
const puppeteer = require('puppeteer');
const sharp = require('sharp');
const fs = require('fs');
const path = require('path');

const app = express();
app.use(express.json());

// Servir arquivos estáticos do diretório "archives"
app.use('/archives', express.static(path.join(__dirname, 'archives')));

// Função auxiliar para validar o nome do arquivo
const isValidFilename = (filename) => /^[a-zA-Z0-9_-]+$/.test(filename);

// Função para remover arquivos antigos
const removeOldFiles = (directory, maxAgeInHours) => {
    const now = Date.now();
    const maxAgeInMilliseconds = maxAgeInHours * 60 * 60 * 1000;

    fs.readdir(directory, (err, files) => {
        if (err) {
            console.error(`Error reading directory ${directory}:`, err.message);
            return;
        }

        files.forEach((file) => {
            const filePath = path.join(directory, file);

            fs.stat(filePath, (err, stats) => {
                if (err) {
                    console.error(`Error getting stats for file ${filePath}:`, err.message);
                    return;
                }

                const fileAge = now - stats.mtimeMs;
                if (fileAge > maxAgeInMilliseconds) {
                    fs.unlink(filePath, (err) => {
                        if (err) {
                            console.error(`Error deleting file ${filePath}:`, err.message);
                        } else {
                            console.log(`Deleted old file: ${filePath}`);
                        }
                    });
                }
            });
        });
    });
};

const CHROMIUM_PATHS = [
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
    '/snap/bin/chromium',
];

const getChromiumPath = () => {
    for (const path of CHROMIUM_PATHS) {
        if (fs.existsSync(path)) {
            console.log(`Chromium found at: ${path}`);
            return path;
        }
    }
    throw new Error('Chromium not found. Please check the installation.');
};

const CHROMIUM_PATH = getChromiumPath();

// Inicializar navegador Puppeteer global para reutilização
let browser;

(async () => {
    try {
        console.log('Launching Puppeteer with Chromium...');
        browser = await puppeteer.launch({
            headless: true,
            executablePath: CHROMIUM_PATH, // Caminho correto detectado
            args: [
                '--no-sandbox',
                '--disable-setuid-sandbox',
            ],
        });

        // Iniciar o servidor na porta 3000
        const PORT = 3000;
        app.listen(PORT, () => {
            console.log(`API running on http://localhost:${PORT}`);
        });

        // Executar limpeza periódica de arquivos antigos
        setInterval(() => {
            console.log('Running cleanup task...');
            removeOldFiles(path.join(__dirname, 'archives'), 24);
        }, 60 * 60 * 1000); // Intervalo de 1 hora para limpar arquivos antigos

    } catch (error) {
        console.error('Error launching Puppeteer:', error);
        process.exit(1); // Encerrar o processo em caso de erro na inicialização
    }
})();

// Fila para gerenciar páginas simultâneas
const MAX_PAGES = 5;
const queue = [];

// Endpoint para capturar screenshot
app.post('/capture', async (req, res) => {
    const { url, headerSelector, summarySelector, filename, width } = req.body;

    if (!url || !headerSelector || !summarySelector || !filename) {
        return res.status(400).send({ error: 'URL, headerSelector, summarySelector, and filename are required.' });
    }

    if (!isValidFilename(filename)) {
        return res.status(400).send({ error: 'Invalid filename format. Use only letters, numbers, underscores, or dashes.' });
    }

    if (queue.length >= MAX_PAGES) {
        return res.status(503).send({ error: 'Server busy. Try again later.' });
    }

    queue.push(true); // Adicionar à fila

    try {
        console.log('Opening new page...');
        const page = await browser.newPage();

        console.log('Setting viewport for mobile resolution...');
        await page.setViewport({
            width: 375,
            height: 812,
            deviceScaleFactor: 2,
        });

        console.log(`Navigating to URL: ${url}`);
        await page.goto(url, { waitUntil: 'networkidle2' });

        // Espera os dois elementos serem encontrados
        await page.waitForSelector(headerSelector, { timeout: 5000 });
        await page.waitForSelector(summarySelector, { timeout: 5000 });

        // Captura as posições do header e do summary
        const headerBox = await page.$eval(headerSelector, el => el.getBoundingClientRect());
        const summaryBox = await page.$eval(summarySelector, el => el.getBoundingClientRect());

        // Verifica se as coordenadas são válidas (não são NaN)
        if (isNaN(headerBox.top) || isNaN(headerBox.bottom) || isNaN(summaryBox.top) || isNaN(summaryBox.bottom)) {
            throw new Error('Invalid coordinates: Ensure elements are visible and properly selected.');
        }

        // Calcula a área a ser capturada (do início do header ao final do summary)
        const clip = {
            x: 0,
            y: headerBox.top,
            width: 375, // Largura da viewport
            height: summaryBox.bottom - headerBox.top, // Distância entre o topo do header e o final do summary
        };

        // Verifica se o clip tem dimensões válidas
        if (clip.height <= 0 || clip.width <= 0) {
            throw new Error('Invalid clip dimensions. Ensure header and summary are properly selected.');
        }

        const archiveDir = path.join(__dirname, 'archives');
        if (!fs.existsSync(archiveDir)) {
            fs.mkdirSync(archiveDir, { recursive: true });
        }

        const originalScreenshotPath = path.join(archiveDir, `${filename}-original.png`);
        const resizedScreenshotPath = path.join(archiveDir, `${filename}.png`);

        console.log(`Capturing screenshot with custom clip...`);
        await page.screenshot({ path: originalScreenshotPath, clip });

        console.log(`Resizing image for mobile: width = ${parseInt(width) || 300}px`);
        await sharp(originalScreenshotPath)
            .resize({ width: parseInt(width) || 300 })
            .toFile(resizedScreenshotPath);

        if (fs.existsSync(originalScreenshotPath)) {
            fs.unlinkSync(originalScreenshotPath);
        }

        console.log('Closing page...');
        await page.close();

        const imageUrl = `${req.protocol}://${req.get('host')}/archives/${filename}.png`;
        res.status(200).send({ imageUrl });
    } catch (error) {
        console.error(`Error: ${error.message}`);
        res.status(500).send({ error: error.message });
    } finally {
        queue.pop(); // Remover da fila
    }
});
