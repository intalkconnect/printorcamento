const express = require('express');
const puppeteer = require('puppeteer');
const sharp = require('sharp'); // Importar o Sharp
const fs = require('fs');
const path = require('path');

const app = express();
app.use(express.json()); // Para permitir JSON no corpo da requisição

// Configurar o Express para servir arquivos estáticos
app.use('/screenshots', express.static(path.join(__dirname, 'archive')));

// Função auxiliar para validar o nome do arquivo
const isValidFilename = (filename) => /^[a-zA-Z0-9_-]+$/.test(filename);

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
        // Iniciar o navegador Puppeteer
        browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox'] });
        const page = await browser.newPage();

        // Configurar a viewport (resolução) para simular um dispositivo móvel
        console.log(`Setting viewport for mobile resolution`);
        await page.setViewport({
            width: 375, // Largura típica de um celular (ex.: iPhone X)
            height: 812, // Altura típica de um celular (pode ajustar)
            deviceScaleFactor: 2, // Simula densidade de pixels (ex.: Retina Display)
        });

        console.log(`Navigating to URL: ${url}`);
        await page.goto(url, { waitUntil: 'networkidle2' });

        // Aguarde o elemento estar disponível no DOM
        console.log(`Waiting for selector: ${selector}`);
        await page.waitForSelector(selector, { timeout: 5000 });

        // Localizar o elemento
        const element = await page.$(selector);
        if (!element) {
            throw new Error('Element not found with the given selector.');
        }

        // Diretório para salvar os screenshots
        const screenshotsDir = path.join(__dirname, 'screenshots');
        if (!fs.existsSync(screenshotsDir)) {
            fs.mkdirSync(screenshotsDir);
        }

        // Caminho completo para salvar a imagem original
        const originalScreenshotPath = path.join(screenshotsDir, `${filename}.png`);

        // Capturar o screenshot do elemento
        console.log(`Saving screenshot to: ${originalScreenshotPath}`);
        await element.screenshot({ path: originalScreenshotPath });

        // Redimensionar a imagem (opcional)
        const resizedScreenshotPath = path.join(screenshotsDir, `${filename}.png`);
        const resizeOptions = {
            width: parseInt(width) || 300, // Largura padrão de 300px
        };

        console.log(`Resizing image for mobile: width = ${resizeOptions.width}px`);
        await sharp(originalScreenshotPath)
            .resize(resizeOptions) // Apenas largura, manter proporção
            .toFile(resizedScreenshotPath);

        // Remover o screenshot original após redimensionar
        fs.unlinkSync(originalScreenshotPath);

        // Retornar a URL pública da imagem redimensionada
        const imageUrl = `${req.protocol}://${req.get('host')}/screenshots/${filename}.png`;
        res.status(200).send({ imageUrl });

    } catch (error) {
        console.error(`Error: ${error.message}`);
        res.status(500).send({ error: error.message });
    } finally {
        if (browser) {
            await browser.close();
        }
    }
});

// Iniciar o servidor na porta 3000
const PORT = 3000;
app.listen(PORT, () => {
    console.log(`API running on http://localhost:${PORT}`);
});
