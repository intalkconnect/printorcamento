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

// Caminhos possíveis do Chromium
const CHROMIUM_PATHS = [
    '/usr/bin/chromium-browser',
    '/usr/bin/chromium',
    '/snap/bin/chromium',
];

// Detectar o caminho correto do Chromium
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
    console.log('Launching Puppeteer with Chromium...');
    browser = await puppeteer.launch({
        headless: true,
        executablePath: CHROMIUM_PATH, // Usar o Chromium instalado no sistema
        args: ['--no-sandbox', '--disable-setuid-sandbox'],
    });
})();

// Fila para gerenciar páginas simultâneas
const MAX_PAGES = 5;
const queue = [];

// Endpoint para capturar screenshot
app.post('/capture', async (req, res) => {
    const { url, selector, filename, width } = req.body;

    if (!url || !selector || !filename) {
        return res.status(400).send({ error: 'URL, selector, and filename are required.' });
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

        console.log(`Waiting for selector: ${selector}`);
        await page.waitForSelector(selector, { timeout: 5000 });

        const element = await page.$(selector);
        if (!element) {
            throw new Error('Element not found with the given selector.');
        }

        const archiveDir = path.join(__dirname, 'archives');
        if (!fs.existsSync(archiveDir)) {
            fs.mkdirSync(archiveDir, { recursive: true });
        }

        const originalScreenshotPath = path.join(archiveDir, `${filename}-original.png`);
        const resizedScreenshotPath = path.join(archiveDir, `${filename}.png`);

        console.log(`Saving screenshot to: ${originalScreenshotPath}`);
        await element.screenshot({ path: originalScreenshotPath });

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

// Iniciar o servidor na porta 3000
const PORT = 3000;
app.listen(PORT, () => {
    console.log(`API running on http://localhost:${PORT}`);
});

// Executar limpeza periódica de arquivos antigos
setInterval(() => {
    console.log('Running cleanup task...');
    removeOldFiles(path.join(__dirname, 'archives'), 24);
}, 60 * 60 * 1000);
