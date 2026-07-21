#!/bin/bash

echo "======================================"
echo "  Handball Tracker - Pi Setup Script  "
echo "======================================"

echo -e "\n[1/4] Updating system packages..."
sudo apt-get update && sudo apt-get upgrade -y

echo -e "\n[2/4] Installing Node.js (v20) and npm..."
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs

echo -e "\n[3/4] Installing Chromium (required for WhatsApp bot)..."
sudo apt-get install -y chromium-browser chromium-codecs-ffmpeg

echo -e "\n[4/4] Installing PM2 and project dependencies..."
sudo npm install -g pm2
npm install

echo -e "\n======================================"
echo "          Setup Complete!             "
echo "======================================"
echo "Next Steps:"
echo "1. Create your .env file: nano .env"
echo "2. Run 'node server.js' to scan the QR code and get your Group ID."
echo "3. Add the TARGET_GROUP_ID to your .env file."
echo "4. Run 'pm2 start server.js --name handball-tracker' to run it in the background."
