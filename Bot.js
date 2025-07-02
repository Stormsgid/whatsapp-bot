const { default: makeWASocket, useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion, downloadMediaMessage } = require('@whiskeysockets/baileys');
const { Boom } = require('@hapi/boom');
const qrcode = require('qrcode-terminal');
const path = require('path');
const fs = require('fs');

const OWNER_NUMBER = '14389931796@s.whatsapp.net';
let adminModeGroups = new Set();
let privateCommandsEnabled = true;
let antiLinkGroups = new Set();
let warningMap = new Map();

async function startBot() {
  const { state, saveCreds } = await useMultiFileAuthState('./auth_info');
  const { version } = await fetchLatestBaileysVersion();

  const sock = makeWASocket({
    version,
    auth: state,
    printQRInTerminal: true
  });

  sock.ev.on('connection.update', (update) => {
    const { connection, lastDisconnect, qr } = update;
    if (qr) {
      console.log('📱 Escaneie o QR Code abaixo:');
      qrcode.generate(qr, { small: true });
    }
    if (connection === 'close') {
      const shouldReconnect = (lastDisconnect?.error instanceof Boom)
        ? lastDisconnect.error.output?.statusCode !== DisconnectReason.loggedOut
        : true;
      console.log('❌ Conexão encerrada. Reconectando?', shouldReconnect);
      if (shouldReconnect) startBot();
    }
    if (connection === 'open') {
      console.log('✅ Bot conectado!');
    }
  });

  sock.ev.on('creds.update', saveCreds);

  sock.ev.on('messages.upsert', async ({ messages, type }) => {
    if (type !== 'notify') return;

    const msg = messages[0];
    if (!msg.message || msg.key.fromMe) return;

    const jid = msg.key.remoteJid;
    const isGroup = jid.endsWith('@g.us');
    const sender = msg.key.participant || msg.key.remoteJid;
    const text = msg.message.conversation || msg.message.extendedTextMessage?.text || '';

    const isOwner = sender === OWNER_NUMBER;

    async function isAdmin() {
      if (!isGroup) return false;
      const metadata = await sock.groupMetadata(jid);
      const admins = metadata.participants.filter(p => p.admin !== null).map(p => p.id);
      return admins.includes(sender);
    }

    if (isGroup && adminModeGroups.has(jid)) {
      const senderIsAdmin = await isAdmin();
      if (!senderIsAdmin) return;
    }

    if (!isGroup && !privateCommandsEnabled && !isOwner) return;

    // 🛡️ Anti-Link com aviso, remoção de mensagem e banimento após 3 avisos
    const isLink = text.match(/(https?:\/\/)?(www\.)?(chat\.whatsapp\.com)\/[\w\d]{20,}/i);
    if (isGroup && antiLinkGroups.has(jid) && isLink) {
      if (!(await isAdmin()) && !isOwner) {
        await sock.sendMessage(jid, { delete: msg.key }); // Apaga a mensagem
        const currentWarnings = warningMap.get(sender) || 0;
        const newWarnings = currentWarnings + 1;

        warningMap.set(sender, newWarnings);

        if (newWarnings >= 3) {
          await sock.sendMessage(jid, { text: `🚫 @${sender.split('@')[0]} foi banido por enviar links!`, mentions: [sender] });
          await sock.groupParticipantsUpdate(jid, [sender], 'remove');
          warningMap.delete(sender);
        } else {
          await sock.sendMessage(jid, { text: `⚠️ @${sender.split('@')[0]}, não envie links! Aviso ${newWarnings}/3.`, mentions: [sender] });
        }
        return;
      }
    }

    // 📌 Comando: /help
    if (text.startsWith('/help')) {
      const helpMsg = `
Comandos:
/help - Lista comandos
/anuncio <msg> - [admin] Envia anúncio
/adminmode on/off - [dono] Ativa modo admin
/privatecmds on/off - [dono] Liga/desliga comandos privados
/marcainativos - Marcar membros inativos
/antilink on/off - [admin] Ativa/desativa anti-link
      `;
      await sock.sendMessage(jid, { text: helpMsg }, { quoted: msg });
      return;
    }

    // 📌 Comando: /anuncio
    if (text.startsWith('/anuncio ')) {
      if (!isGroup || !(await isAdmin())) return;
      const announcement = text.slice(9).trim();
      if (!announcement) return;
      const allChats = await sock.groupFetchAllParticipating();
      for (const groupId of Object.keys(allChats)) {
        await sock.sendMessage(groupId, { text: `📢 Anúncio:\n\n${announcement}` });
      }
      await sock.sendMessage(jid, { text: '✅ Anúncio enviado.' }, { quoted: msg });
      return;
    }

    // 📌 Comando: /adminmode
    if (text.startsWith('/adminmode ')) {
      if (!isOwner || !isGroup) return;
      const param = text.split(' ')[1]?.toLowerCase();
      if (param === 'on') {
        adminModeGroups.add(jid);
        await sock.sendMessage(jid, { text: '✅ Modo admin ativado.' }, { quoted: msg });
      } else if (param === 'off') {
        adminModeGroups.delete(jid);
        await sock.sendMessage(jid, { text: '✅ Modo admin desativado.' }, { quoted: msg });
      } else {
        await sock.sendMessage(jid, { text: 'Use: /adminmode on|off' }, { quoted: msg });
      }
      return;
    }

    // 📌 Comando: /privatecmds
    if (text.startsWith('/privatecmds ')) {
      if (!isOwner) return;
      const param = text.split(' ')[1]?.toLowerCase();
      if (param === 'on') {
        privateCommandsEnabled = true;
        await sock.sendMessage(jid, { text: '✅ Comandos no privado ativados.' }, { quoted: msg });
      } else if (param === 'off') {
        privateCommandsEnabled = false;
        await sock.sendMessage(jid, { text: '✅ Comandos no privado desativados.' }, { quoted: msg });
      } else {
        await sock.sendMessage(jid, { text: 'Use: /privatecmds on|off' }, { quoted: msg });
      }
      return;
    }

    // 📌 Comando: /marcainativos
    if (text === '/marcainativos') {
      if (!isGroup) return;
      await sock.sendMessage(jid, { text: '📋 Ainda vou aprender a identificar inativos...' }, { quoted: msg });
      return;
    }

    // 📌 Comando: /antilink
    if (text.startsWith('/antilink ')) {
      if (!isGroup || !(await isAdmin())) return;
      const param = text.split(' ')[1]?.toLowerCase();
      if (param === 'on') {
        antiLinkGroups.add(jid);
        await sock.sendMessage(jid, { text: '✅ Anti-link ativado.' }, { quoted: msg });
      } else if (param === 'off') {
        antiLinkGroups.delete(jid);
        await sock.sendMessage(jid, { text: '✅ Anti-link desativado.' }, { quoted: msg });
      }
      return;
    }

    // 🤖 Resposta ao "oi"
    if (text.toLowerCase() === 'oi') {
      await sock.sendMessage(jid, { text: 'Olá! Como posso ajudar?' }, { quoted: msg });
      return;
    }

    // 🌙 Comando: boa noite
    if (text.toLowerCase() === 'boa noite') {
      let tag = 'usuário';
      if (sender === OWNER_NUMBER) {
        tag = 'dono';
      } else if (isGroup && (await isAdmin())) {
        tag = 'admin';
      }

      if (tag === 'dono' || tag === 'admin') {
        await sock.sendMessage(jid, { text: 'Boa noite, mestre!' });
        if (isGroup) {
          await sock.groupSettingUpdate(jid, 'announcement');
          await sock.sendMessage(jid, { text: '🌙 Grupo fechado. Nengue bazou, vão dormir!' });
        }
      } else {
        await sock.sendMessage(jid, { text: 'Boa noite!' });
      }
      return;
    }
  });
}

startBot();
// This code is a simple WhatsApp bot using Baileys library.