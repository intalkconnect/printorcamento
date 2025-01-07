# Usar uma imagem Node.js oficial como base
FROM node:18-slim

# Instalar dependências do sistema e o Chromium
RUN apt-get update && apt-get install -y \
    git \
    chromium \
    libnss3 \
    libatk1.0-0 \
    libcups2 \
    libdbus-1-3 \
    libx11-xcb1 \
    libxcomposite1 \
    libxdamage1 \
    libxrandr2 \
    libgbm1 \
    libpango-1.0-0 \
    libcairo2 \
    libasound2 \
    libatspi2.0-0 \
    libxkbcommon0 \
    libgtk-3-0 \
    fonts-liberation \
    wget \
    && apt-get clean && rm -rf /var/lib/apt/lists/*

# Definir o diretório de trabalho dentro do container
WORKDIR /code

# Clonar o repositório diretamente do GitHub
RUN git clone https://github.com/intalkconnect/printorcamento.git /code

# Instalar as dependências do Node.js
RUN npm install

# Configurar variável de ambiente para o Puppeteer usar o Chromium instalado
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium

# Expor a porta 3000
EXPOSE 3000

# Comando para rodar a aplicação
CMD ["node", "app.js"]
