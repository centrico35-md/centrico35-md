# CENTRICO-MD

A defensive WhatsApp Multi-Device bot built with Baileys and MongoDB.

## Setup

```bash
cd bot
cp .env.example .env
npm install
npm start
```

The first run prints a QR code in the terminal. Scan it from WhatsApp > Linked devices > Link a device.

## Environment

- `PREFIX` command prefix, default `!`
- `ADMIN_NUMBERS` comma-separated WhatsApp numbers in international format without `+`
- `MONGODB_URI` optional MongoDB connection string
- `AUTH_DIR` session directory
- `MEDIA_DIR` downloaded media directory
- `RATE_LIMIT_MAX` messages allowed per window
- `RATE_LIMIT_WINDOW_MS` rate-limit window
- `LOG_MESSAGES` set to `false` to disable MongoDB message logging

Never commit `.env` or authentication/session files.

## Commands

- `!help` — command list
- `!ping` — health check
- `!info` — bot information
- `!tagall` — group admin command
- `!kick @user` — group admin command

The bot also welcomes new group members, sends goodbye messages, handles common media types, logs messages when enabled, and reconnects after temporary connection loss.

## Deployment

Run locally in Termux/Linux, or deploy the `bot` directory to a Node.js-capable VPS/container. For production, use a process supervisor and a managed MongoDB instance, and keep the auth directory persistent.

This project is intended for legitimate automation on accounts/groups you control. It does not implement account disruption, mass messaging, ban evasion, or abuse tooling.
