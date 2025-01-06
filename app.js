const express = require('express');
const puppeteer = require('puppeteer');
const sharp = require('sharp');
const fs = require('fs');
const path = require('path');

const app = express();
app.use(express.json());

app.use('/screenshots', express.static(path.join(__dirname, 'screenshots')));

const isValidFilename = (filename) => /^[a-zA-Z0-9_-]+$/.test(filename);

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
        console.log('Launching Chromium...');
        browser = await puppeteer.launch({
            executablePath: '/usr/bin/chromium-browser', // Configurado para usar o Chromium instalado
            headless: true,
            args: ['--no-sandbox', '--disable-setuid-sandbox'],
        });

        const page = await browser.newPage();
        console.log('Navigating to URL:', url);
        await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 });

        console.log('Waiting for selector:', selector);
        await page.waitForSelector(selector, { timeout: 5000 });

        const element = await page.$(selector);
        if (!element) throw new Error('Element not found with the given selector.');

        const screenshotsDir = path.join(__dirname, 'screenshots');
        if (!fs.existsSync(screenshotsDir)) {
            fs.mkdirSync(screenshotsDir, { recursive: true });
        }

        const originalScreenshotPath = path.join(screenshotsDir, `${filename}.png`);
        console.log('Saving screenshot to:', originalScreenshotPath);
        await element.screenshot({ path: originalScreenshotPath });

        const resizedScreenshotPath = path.join(screenshotsDir, `${filename}.png`);
        const resizeOptions = {
            width: Number.isInteger(parseInt(width)) ? parseInt(width) : 300,
        };

        console.log('Resizing image...');
        await sharp(originalScreenshotPath)
            .resize(resizeOptions)
            .toFile(resizedScreenshotPath);

        fs.unlinkSync(originalScreenshotPath);

        const imageUrl = `${req.protocol}://${req.get('host')}/screenshots/${filename}.png`;
        res.status(200).send({ imageUrl });

    } catch (error) {
        console.error('Error:', error.message);
        res.status(500).send({ error: error.message });
    } finally {
        if (browser && browser.process()) {
            console.log('Closing browser...');
            await browser.close();
        }
    }
});

const PORT = 3000;
app.listen(PORT, () => {
    console.log(`API running on http://localhost:${PORT}`);
});
