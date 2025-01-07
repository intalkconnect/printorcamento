const express = require('express');
const puppeteer = require('puppeteer');
const sharp = require('sharp');
const fs = require('fs');
const path = require('path');

const app = express();
app.use(express.json());

// Servir arquivos estáticos do diretório "archive"
app.use('/archives', express.static(path.join(__dirname, 'archives')));

// Função auxiliar para validar o nome do arquivo
const isValidFilename = (filename) => /^[a-zA-Z0-9_-]+$/.test(filename);

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

// Endpoint para capturar screenshot
app.post('/capture', async (req, res) => {
    const { url, selector, filename, width } = req.body;

    if (!url || !selector || !filename) {
        return res.status(400).send({ error: 'URL, selector, and filename are required.' });
    }

    if (!isValidFilename(filename)) {
        return res.status(400).send({ error: 'Invalid filename format. Use only letters, numbers, underscores, or dashes.' });
    }

    let browser;
    try {
        console.log('Launching browser...');
        browser = await puppeteer.launch({
            headless: true,
            args: ['--no-sandbox', '--disable-setuid-sandbox'], // Configuração para execução como root
        });
        const page = await browser.newPage();

        console.log('Setting viewport for mobile resolution...');
        await page.setViewport({
            width: 375, // Largura típica de um celular (ex.: iPhone X)
            height: 812, // Altura típica de um celular
            deviceScaleFactor: 2, // Simula densidade de pixels (ex.: Retina Display)
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

        // Caminho completo para salvar a imagem original
        const originalScreenshotPath = path.join(archiveDir, `${filename}-original.png`);
        const resizedScreenshotPath = path.join(archiveDir, `${filename}.png`);

        console.log(`Saving screenshot to: ${originalScreenshotPath}`);
        await element.screenshot({ path: originalScreenshotPath });

        // Redimensionar a imagem com caminho de saída diferente
        console.log(`Resizing image for mobile: width = ${parseInt(width) || 300}px`);
        await sharp(originalScreenshotPath)
            .resize({ width: parseInt(width) || 300 }) // Apenas largura, manter proporção
            .toFile(resizedScreenshotPath);

        // Remover o screenshot original
        if (fs.existsSync(originalScreenshotPath)) {
            fs.unlinkSync(originalScreenshotPath);
        }

        // Retornar a URL pública da imagem redimensionada
        const imageUrl = `${req.protocol}://${req.get('host')}/archives/${filename}.png`;
        res.status(200).send({ imageUrl });

    } catch (error) {
        console.error(`Error: ${error.message}`);
        res.status(500).send({ error: error.message });
    } finally {
        if (browser) {
            console.log('Closing browser...');
            await browser.close();
        }
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
