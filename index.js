process.on('uncaughtException', (err) => {
    console.error('❌ ERROR NO CAPTURADO:', err);
});

process.on('unhandledRejection', (reason) => {
    console.error('❌ PROMESA RECHAZADA:', reason);
});

const {
    default: makeWASocket,
    useMultiFileAuthState,
    DisconnectReason,
    Browsers,
    fetchLatestWaWebVersion,
    downloadContentFromMessage
} = require('@whiskeysockets/baileys');

const express = require('express');
const fs = require('fs');
const path = require('path');
const pino = require('pino');
const QRCode = require('qrcode');

// ======================================================
// CONFIGURACIÓN Y VARIABLES DE ENTORNO
// ======================================================

const DATA_DIR = process.env.RAILWAY_VOLUME_MOUNT_PATH || '/app/data';
const AUTH_DIR = path.join(DATA_DIR, 'sesion_tienda_v3');
const DB_FILE = path.join(DATA_DIR, 'db.json');

const GRUPO_RECORDATORIO_ENV = process.env.GRUPO_RECORDATORIO || '';

if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
}

console.log('');
console.log('========================================');
console.log('🤖 BOT TIENDA SAMANTHA LA HACKER');
console.log('========================================');
console.log('📁 DATA_DIR:', DATA_DIR);
console.log('🔐 AUTH_DIR:', AUTH_DIR);
console.log('🗄️ DB_FILE:', DB_FILE);
console.log('========================================');
console.log('');

// ======================================================
// EXPRESS
// ======================================================

let qrImage = '';
const app = express();
const PORT = process.env.PORT || 3000;

app.get('/', (req, res) => {
    if (qrImage) {
        res.send(`
<!DOCTYPE html>
<html lang="es">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <meta http-equiv="refresh" content="10">
    <title>Bot Tienda Samantha</title>
    <style>
        * { box-sizing: border-box; }
        body { margin: 0; min-height: 100vh; display: flex; align-items: center; justify-content: center; font-family: Arial, Helvetica, sans-serif; background: linear-gradient(135deg, #111827, #1f2937); color: #111827; }
        .card { width: 90%; max-width: 450px; background: white; padding: 30px; border-radius: 20px; text-align: center; box-shadow: 0 20px 50px rgba(0,0,0,0.35); }
        h1 { margin-top: 0; font-size: 25px; }
        img { width: 280px; height: 280px; max-width: 100%; margin: 15px 0; border-radius: 10px; }
        .success { color: #16a34a; font-weight: bold; }
        .info { color: #666; font-size: 14px; }
    </style>
</head>
<body>
    <div class="card">
        <h1>📱 Vincular Bot WhatsApp</h1>
        <p>Escanea este código QR desde WhatsApp.</p>
        <img src="${qrImage}" alt="Código QR de WhatsApp">
        <p class="success">🟢 QR generado correctamente</p>
        <p class="info">El código se actualiza automáticamente.</p>
        <p class="info">Bot Tienda Samantha Online 24/7 🚀</p>
    </div>
</body>
</html>
        `);
    } else {
        res.send(`
<!DOCTYPE html>
<html lang="es">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <meta http-equiv="refresh" content="5">
    <title>Bot Tienda Samantha</title>
</head>
<body style="margin:0; min-height:100vh; display:flex; align-items:center; justify-content:center; font-family:Arial, sans-serif; background:#f4f4f9; text-align:center;">
    <div>
        <h1>🤖 Bot Tienda Samantha Online 24/7 🚀</h1>
        <p><b>Estado:</b> conectando con WhatsApp...</p>
        <p>El QR aparecerá automáticamente.</p>
        <p>🔄 Recargando...</p>
    </div>
</body>
</html>
        `);
    }
});

app.get('/health', (req, res) => {
    res.json({ ok: true, bot: 'Tienda Samantha', qr: !!qrImage, time: new Date().toISOString() });
});

app.listen(PORT, () => {
    console.log(`🌐 Servidor Express activo en puerto ${PORT}`);
});

// ======================================================
// BASE DE DATOS
// ======================================================

function loadDB() {
    const defaultDB = {
        saldos: {},
        stock: {},
        precios: {},
        pago: "",
        ventas: [],
        grupos: {},
        textos: {},
        recordatorios: []
    };

    if (!fs.existsSync(DB_FILE)) {
        fs.writeFileSync(DB_FILE, JSON.stringify(defaultDB, null, 2));
        return defaultDB;
    }
    try {
        const data = JSON.parse(fs.readFileSync(DB_FILE, 'utf-8'));
        if (!data.pago) data.pago = "";
        if (!data.ventas) data.ventas = [];
        if (!data.grupos) data.grupos = {};
        if (!data.textos) data.textos = {};
        if (!data.recordatorios) data.recordatorios = [];
        return data;
    } catch (error) {
        console.error('❌ ERROR LEYENDO db.json:', error);
        return defaultDB;
    }
}

function saveDB(data) {
    try { fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2)); } 
    catch (error) { console.error('❌ ERROR GUARDANDO db.json:', error); }
}

let reconnectTimer = null;
let reminderInterval = null;
let botStarting = false;

function scheduleReconnect(delay = 5000) {
    if (reconnectTimer) return;
    reconnectTimer = setTimeout(() => {
        reconnectTimer = null;
        startBot();
    }, delay);
}

// ======================================================
// FUNCIONES AUXILIARES
// ======================================================
function obtenerNumeroBase(jid) {
    if (!jid) return '';
    let num = jid.split('@')[0].split(':')[0];
    if (num.length >= 10) {
        return num.slice(-10);
    }
    return num;
}

function obtenerHoraMexico() {
    const now = new Date();
    const formatter = new Intl.DateTimeFormat('en-GB', {
        timeZone: 'America/Mexico_City',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false
    });
    const fechaFormatter = new Intl.DateTimeFormat('en-CA', {
        timeZone: 'America/Mexico_City',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit'
    });
    return {
        hora: formatter.format(now),
        fecha: fechaFormatter.format(now)
    };
}

// ======================================================
// INICIAR BOT
// ======================================================

async function startBot() {
    if (botStarting) return;
    botStarting = true;

    try {
        console.log('\n========================================');
        console.log('🚀 INICIANDO BAILEYS');
        console.log('========================================');

        if (!fs.existsSync(AUTH_DIR)) fs.mkdirSync(AUTH_DIR, { recursive: true });

        const { state, saveCreds } = await useMultiFileAuthState(AUTH_DIR);
        const { version } = await fetchLatestWaWebVersion();

        const sock = makeWASocket({
            version,
            logger: pino({ level: 'silent' }), 
            auth: state,
            printQRInTerminal: false,
            browser: Browsers.ubuntu('Chrome'),
            connectTimeoutMs: 60000,
            keepAliveIntervalMs: 30000,
            markOnlineOnConnect: false
        });

        sock.ev.on('creds.update', saveCreds);

        sock.ev.on('connection.update', async (update) => {
            const { connection, lastDisconnect, qr } = update;

            if (qr) {
                try {
                    qrImage = await QRCode.toDataURL(qr);
                    console.log('✅ QR convertido a imagen correctamente.');
                } catch (error) { console.error('❌ ERROR GENERANDO QR:', error); }
            }

            if (connection === 'close') {
                qrImage = '';
                if (reminderInterval) {
                    clearInterval(reminderInterval);
                    reminderInterval = null;
                }

                const error = lastDisconnect?.error;
                const statusCode = error?.output?.statusCode;

                if (statusCode === DisconnectReason.loggedOut || statusCode === 403) {
                    console.log('🚪 WhatsApp cerró la sesión o el número fue baneado.');
                    try { if (fs.existsSync(AUTH_DIR)) fs.rmSync(AUTH_DIR, { recursive: true, force: true }); } 
                    catch (error) { console.error('❌ ERROR ELIMINANDO AUTH:', error); }
                } else {
                    console.log('⏳ Reconectando en 5 segundos...');
                }

                botStarting = false;
                scheduleReconnect();
                return;
            }

            if (connection === 'open') {
                console.log('✅ WHATSAPP CONECTADO CORRECTAMENTE');
                qrImage = '';
                botStarting = false;

                // ==================================================
                // MOTOR DE RECORDATORIOS AUTOMÁTICOS
                // ==================================================
                if (reminderInterval) clearInterval(reminderInterval);
                reminderInterval = setInterval(async () => {
                    try {
                        const db = loadDB();
                        if (!db.recordatorios || db.recordatorios.length === 0) return;

                        const { hora, fecha } = obtenerHoraMexico();
                        let huboCambios = false;

                        for (const rec of db.recordatorios) {
                            if (!rec.activo) continue;
                            
                            const targetGroup = rec.grupoId || GRUPO_RECORDATORIO_ENV;
                            if (!targetGroup) continue;

                            if (rec.hora === hora && rec.ultimoEnvio !== fecha) {
                                rec.ultimoEnvio = fecha;
                                huboCambios = true;

                                const imgRecPath = path.join(DATA_DIR, `rec_${rec.id}.jpg`);
                                if (fs.existsSync(imgRecPath)) {
                                    await sock.sendMessage(targetGroup, {
                                        image: { url: imgRecPath },
                                        caption: rec.mensaje
                                    });
                                } else {
                                    await sock.sendMessage(targetGroup, {
                                        text: rec.mensaje
                                    });
                                }
                            }
                        }

                        if (huboCambios) saveDB(db);
                    } catch (err) {
                        console.error('❌ Error en ciclo de recordatorios:', err);
                    }
                }, 30000);
            }
        });

        // ==================================================
        // SISTEMA DE BIENVENIDAS Y DESPEDIDAS
        // ==================================================
        sock.ev.on('group-participants.update', async (update) => {
            try {
                const { id, participants, action } = update;
                const db = loadDB();
                
                if (!db.grupos || !db.grupos[id]) return;
                const config = db.grupos[id];

                for (const participant of participants) {
                    let ppUrl = null;
                    try {
                        ppUrl = await sock.profilePictureUrl(participant, 'image');
                    } catch (e) {
                        ppUrl = null;
                    }

                    if (action === 'add' && config.welcome) {
                        let text = config.welcomeMsg || '¡Bienvenido(a) al grupo @usuario!';
                        text = text.replace(/@usuario/gi, `@${participant.split('@')[0]}`);
                        
                        const customImgPath = path.join(DATA_DIR, `welcome_${id.split('@')[0]}.jpg`);
                        const audioPath = path.join(DATA_DIR, `welcome_audio_${id.split('@')[0]}.ogg`);

                        if (ppUrl) {
                            await sock.sendMessage(id, { image: { url: ppUrl }, caption: text, mentions: [participant] });
                        } else if (fs.existsSync(customImgPath)) {
                            await sock.sendMessage(id, { image: { url: customImgPath }, caption: text, mentions: [participant] });
                        } else {
                            await sock.sendMessage(id, { text: text, mentions: [participant] });
                        }

                        if (fs.existsSync(audioPath)) {
                            await sock.sendMessage(id, {
                                audio: { url: audioPath },
                                mimetype: 'audio/ogg; codecs=opus',
                                ptt: true
                            });
                        }
                    }

                    if (action === 'remove' && config.bye) {
                        let text = config.byeMsg || '¡Adiós @usuario, te extrañaremos!';
                        text = text.replace(/@usuario/gi, `@${participant.split('@')[0]}`);
                        
                        const customImgPath = path.join(DATA_DIR, `bye_${id.split('@')[0]}.jpg`);
                        const audioPath = path.join(DATA_DIR, `bye_audio_${id.split('@')[0]}.ogg`);

                        if (ppUrl) {
                            await sock.sendMessage(id, { image: { url: ppUrl }, caption: text, mentions: [participant] });
                        } else if (fs.existsSync(customImgPath)) {
                            await sock.sendMessage(id, { image: { url: customImgPath }, caption: text, mentions: [participant] });
                        } else {
                            await sock.sendMessage(id, { text: text, mentions: [participant] });
                        }

                        if (fs.existsSync(audioPath)) {
                            await sock.sendMessage(id, {
                                audio: { url: audioPath },
                                mimetype: 'audio/ogg; codecs=opus',
                                ptt: true
                            });
                        }
                    }
                }
            } catch (e) { console.error('❌ Error enviando Bienvenida/Despedida:', e); }
        });

        // ==================================================
        // LECTURA DE MENSAJES
        // ==================================================
        sock.ev.on('messages.upsert', async ({ messages, type }) => {
            try {
                if (type !== 'notify') return;
                const m = messages[0];
                if (!m || !m.message || m.key.fromMe) return;

                const from = m.key.remoteJid;
                if (!from) return;

                const isGroup = from.endsWith('@g.us');
                const sender = isGroup ? m.key.participant : from;
                const body = m.message.conversation || m.message.extendedTextMessage?.text || m.message.imageMessage?.caption || '';
                
                if (!body.startsWith('.')) return;

                const args = body.slice(1).trim().split(/ +/);
                const command = args.shift().toLowerCase();
                const db = loadDB();

                if (isGroup) {
                    try {
                        const metadata = await sock.groupMetadata(from);
                        const myJid = sock.user?.id || sock.authState?.creds?.me?.id;
                        
                        if (myJid && metadata && metadata.participants) {
                            const botBase = obtenerNumeroBase(myJid);
                            const botParticipant = metadata.participants.find(p => obtenerNumeroBase(p.id) === botBase);
                            
                            if (botParticipant && botParticipant.admin !== 'admin' && botParticipant.admin !== 'superadmin') {
                                return; 
                            }
                        }
                    } catch (error) { }
                }

                async function isAdmin() {
                    if (!isGroup) return false;
                    try {
                        const metadata = await sock.groupMetadata(from);
                        const senderBase = obtenerNumeroBase(sender);
                        const participant = metadata.participants.find(p => obtenerNumeroBase(p.id) === senderBase);
                        return (participant && (participant.admin === 'admin' || participant.admin === 'superadmin'));
                    } catch (error) {
                        return false;
                    }
                }

                async function descargarImagen(msgObj) {
                    let mediaMessage = null;
                    if (msgObj.message?.imageMessage) {
                        mediaMessage = msgObj.message.imageMessage;
                    } else if (msgObj.message?.extendedTextMessage?.contextInfo?.quotedMessage?.imageMessage) {
                        mediaMessage = msgObj.message.extendedTextMessage.contextInfo.quotedMessage.imageMessage;
                    }
                    if (mediaMessage) {
                        const stream = await downloadContentFromMessage(mediaMessage, 'image');
                        let buffer = Buffer.from([]);
                        for await (const chunk of stream) buffer = Buffer.concat([buffer, chunk]);
                        return buffer;
                    }
                    return null;
                }

                async function descargarAudio(msgObj) {
                    let audioMessage = null;
                    if (msgObj.message?.audioMessage) {
                        audioMessage = msgObj.message.audioMessage;
                    } else if (msgObj.message?.extendedTextMessage?.contextInfo?.quotedMessage?.audioMessage) {
                        audioMessage = msgObj.message.extendedTextMessage.contextInfo.quotedMessage.audioMessage;
                    }
                    if (audioMessage) {
                        const stream = await downloadContentFromMessage(audioMessage, 'audio');
                        let buffer = Buffer.from([]);
                        for await (const chunk of stream) buffer = Buffer.concat([buffer, chunk]);
                        return buffer;
                    }
                    return null;
                }

                // ==================================================
                // OSINT: CONSULTA DE IP / DOMINIO (.ip)
                // ==================================================
                if (command === 'ip' || command === 'geoip') {
                    if (!(await isAdmin())) return;
                    const target = args[0];
                    if (!target) {
                        return sock.sendMessage(from, { text: `❌ Uso incorrecto.\nEjemplo: *.ip 8.8.8.8* o *.ip google.com*` }, { quoted: m });
                    }

                    try {
                        const res = await fetch(`http://ip-api.com/json/${encodeURIComponent(target)}?fields=status,message,country,regionName,city,isp,org,as,query,timezone`);
                        const data = await res.json();

                        if (data.status === 'fail') {
                            return sock.sendMessage(from, { text: `❌ No se pudo obtener información de: *${target}* (${data.message})` }, { quoted: m });
                        }

                        let text = `🌐 *INTELIGENCIA DE RED (OSINT)*\n\n`;
                        text += `🔍 *Target:* \`${data.query}\`\n`;
                        text += `📍 *Ubicación:* ${data.city || 'N/A'}, ${data.regionName || 'N/A'}, ${data.country || 'N/A'}\n`;
                        text += `🕒 *Zona Horaria:* ${data.timezone || 'N/A'}\n`;
                        text += `🏢 *ISP / Proveedor:* ${data.isp || 'N/A'}\n`;
                        text += `📡 *Organización:* ${data.org || 'N/A'}\n`;
                        text += `🔢 *ASN:* \`${data.as || 'N/A'}\``;

                        return sock.sendMessage(from, { text }, { quoted: m });
                    } catch (err) {
                        return sock.sendMessage(from, { text: `❌ Error al conectar con el servicio de geolocalización.` }, { quoted: m });
                    }
                }

                // ==================================================
                // GESTIÓN DE ADMINISTRADORES (.daradmin / .quitaradmin)
                // ==================================================
                if (command === 'daradmin' || command === 'promote') {
                    if (!(await isAdmin())) return;
                    const mentioned = m.message.extendedTextMessage?.contextInfo?.mentionedJid?.[0];
                    if (!mentioned) {
                        return sock.sendMessage(from, { text: '❌ Debes etiquetar al usuario. Ejemplo: *.daradmin @usuario*' }, { quoted: m });
                    }

                    try {
                        await sock.groupParticipantsUpdate(from, [mentioned], 'promote');
                        return sock.sendMessage(from, {
                            text: `👑 @${mentioned.split('@')[0]} ahora es *Administrador* del grupo.`,
                            mentions: [mentioned]
                        }, { quoted: m });
                    } catch (e) {
                        return sock.sendMessage(from, { text: '❌ No se pudo dar admin. Verifica que el bot sea Administrador.' }, { quoted: m });
                    }
                }

                if (command === 'quitaradmin' || command === 'demote') {
                    if (!(await isAdmin())) return;
                    const mentioned = m.message.extendedTextMessage?.contextInfo?.mentionedJid?.[0];
                    if (!mentioned) {
                        return sock.sendMessage(from, { text: '❌ Debes etiquetar al usuario. Ejemplo: *.quitaradmin @usuario*' }, { quoted: m });
                    }

                    try {
                        await sock.groupParticipantsUpdate(from, [mentioned], 'demote');
                        return sock.sendMessage(from, {
                            text: `📉 Se han retirado los privilegios de Administrador a @${mentioned.split('@')[0]}.`,
                            mentions: [mentioned]
                        }, { quoted: m });
                    } catch (e) {
                        return sock.sendMessage(from, { text: '❌ No se pudo quitar admin. Verifica que el bot sea Administrador y no sea el creador del grupo.' }, { quoted: m });
                    }
                }

                // ==================================================
                // VER STOCK DETALLADO (Ej. .verstock vix)
                // ==================================================
                if (command === 'verstock') {
                    if (!(await isAdmin())) return;
                    const producto = args[0]?.toLowerCase();

                    if (!producto) {
                        return sock.sendMessage(from, { text: `❌ Debes indicar el producto. Ejemplo: *.verstock vix*` }, { quoted: m });
                    }

                    if (!db.stock[producto] || db.stock[producto].length === 0) {
                        return sock.sendMessage(from, { text: `📦 El producto *${producto.toUpperCase()}* no tiene cuentas en stock actualmente.` }, { quoted: m });
                    }

                    let text = `📋 *INVENTARIO DETALLADO: ${producto.toUpperCase()}*\n\n`;
                    db.stock[producto].forEach((cuenta, index) => {
                        text += `*[${index + 1}]* ${cuenta}\n`;
                    });
                    text += `\n_Para borrar una cuenta específica usa: .delstockitem ${producto} <número>_`;

                    return sock.sendMessage(from, { text }, { quoted: m });
                }

                // ==================================================
                // BORRAR CUENTA ESPECÍFICA (Ej. .delstockitem vix 2)
                // ==================================================
                if (command === 'delstockitem') {
                    if (!(await isAdmin())) return;
                    const producto = args[0]?.toLowerCase();
                    const numeroItem = parseInt(args[1]);

                    if (!producto || isNaN(numeroItem)) {
                        return sock.sendMessage(from, { text: `❌ Uso incorrecto.\nEjemplo: *.delstockitem vix 2*` }, { quoted: m });
                    }

                    if (!db.stock[producto] || db.stock[producto].length === 0) {
                        return sock.sendMessage(from, { text: `❌ El producto *${producto.toUpperCase()}* no tiene stock registrado.` }, { quoted: m });
                    }

                    const index = numeroItem - 1;
                    if (index < 0 || index >= db.stock[producto].length) {
                        return sock.sendMessage(from, { text: `❌ Número de cuenta inválido. Revisa la lista con *.verstock ${producto}*` }, { quoted: m });
                    }

                    const cuentaEliminada = db.stock[producto].splice(index, 1)[0];
                    saveDB(db);

                    return sock.sendMessage(from, {
                        text: `🗑️ Cuenta eliminada exitosamente del stock de *${producto.toUpperCase()}*:\n\`${cuentaEliminada}\`\n\nQuedan *${db.stock[producto].length}* disponibles.`
                    }, { quoted: m });
                }

                // ==================================================
                // RECORDATORIOS Y COMANDOS EXTRA
                // ==================================================
                if (command === 'idgrupo') {
                    if (!(await isAdmin())) return;
                    return sock.sendMessage(from, { text: `🆔 *ID de este grupo:*\n\`${from}\`` }, { quoted: m });
                }

                if (command === 'setrecordatorio' || command === 'addrecordatorio') {
                    if (!(await isAdmin())) return;
                    const horaInput = args.shift();
                    const mensajeRec = args.join(' ');

                    if (!horaInput || !/^([01]\d|2[0-3]):([0-5]\d)$/.test(horaInput)) {
                        return sock.sendMessage(from, {
                            text: `❌ Formato de hora inválido. Usa formato 24 horas (HH:MM).\nEjemplo: *.setrecordatorio 14:30 Mensaje...*`
                        }, { quoted: m });
                    }

                    if (!mensajeRec) {
                        return sock.sendMessage(from, { text: `❌ Debes escribir el mensaje del recordatorio.` }, { quoted: m });
                    }

                    const nuevoId = Date.now().toString().slice(-4);
                    const grupoDestino = GRUPO_RECORDATORIO_ENV || from;

                    const buffer = await descargarImagen(m);
                    if (buffer) fs.writeFileSync(path.join(DATA_DIR, `rec_${nuevoId}.jpg`), buffer);

                    db.recordatorios.push({
                        id: nuevoId,
                        grupoId: grupoDestino,
                        hora: horaInput,
                        mensaje: mensajeRec,
                        activo: true,
                        ultimoEnvio: ""
                    });
                    saveDB(db);

                    return sock.sendMessage(from, { text: `✅ Recordatorio programado correctamente con ID: *${nuevoId}*` }, { quoted: m });
                }

                if (command === 'recordatorios') {
                    if (!(await isAdmin())) return;
                    if (!db.recordatorios || db.recordatorios.length === 0) {
                        return sock.sendMessage(from, { text: `📭 No hay recordatorios configurados.` }, { quoted: m });
                    }
                    let text = `⏰ *RECORDATORIOS ACTIVOS*\n\n`;
                    db.recordatorios.forEach(r => {
                        text += `• ID: \`${r.id}\` | Hora: ${r.hora} | Msg: ${r.mensaje}\n`;
                    });
                    return sock.sendMessage(from, { text }, { quoted: m });
                }

                if (command === 'delrecordatorio') {
                    if (!(await isAdmin())) return;
                    const idBorrar = args[0];
                    const index = db.recordatorios.findIndex(r => r.id === idBorrar);
                    if (index === -1) return sock.sendMessage(from, { text: `❌ No se encontró el ID *${idBorrar}*.` }, { quoted: m });

                    db.recordatorios.splice(index, 1);
                    saveDB(db);
                    return sock.sendMessage(from, { text: `✅ Recordatorio eliminado.` }, { quoted: m });
                }

                if (command === 'crearcmd') {
                    if (!(await isAdmin())) return;
                    const nombreCmd = args.shift()?.toLowerCase();
                    const textoCmd = args.join(' ');
                    if (!nombreCmd) return sock.sendMessage(from, { text: `❌ Uso: *.crearcmd <nombre> <texto>*` }, { quoted: m });

                    if (textoCmd) db.textos[nombreCmd] = textoCmd;
                    const buffer = await descargarImagen(m);
                    if (buffer) fs.writeFileSync(path.join(DATA_DIR, `img_${nombreCmd}.jpg`), buffer);

                    saveDB(db);
                    return sock.sendMessage(from, { text: `✅ Comando *.${nombreCmd}* guardado.` }, { quoted: m });
                }

                if (command === 'delcmd') {
                    if (!(await isAdmin())) return;
                    const nombreCmd = args[0]?.toLowerCase();
                    if (!nombreCmd || !db.textos[nombreCmd]) return sock.sendMessage(from, { text: `❌ El comando no existe.` }, { quoted: m });

                    delete db.textos[nombreCmd];
                    const imgPath = path.join(DATA_DIR, `img_${nombreCmd}.jpg`);
                    if (fs.existsSync(imgPath)) fs.unlinkSync(imgPath);

                    saveDB(db);
                    return sock.sendMessage(from, { text: `✅ Comando eliminado.` }, { quoted: m });
                }

                if (command === 'listacmds') {
                    const keys = Object.keys(db.textos || {});
                    if (keys.length === 0) return sock.sendMessage(from, { text: `📂 No hay comandos personalizados.` }, { quoted: m });
                    let text = `📋 *COMANDOS EXTRA:*\n\n`;
                    keys.forEach((c, i) => text += `${i + 1}. *.${c}*\n`);
                    return sock.sendMessage(from, { text }, { quoted: m });
                }

                if (db.textos[command]) {
                    let text = db.textos[command];
                    const imgPath = path.join(DATA_DIR, `img_${command}.jpg`);
                    if (fs.existsSync(imgPath)) {
                        await sock.sendMessage(from, { image: { url: imgPath }, caption: text }, { quoted: m });
                    } else {
                        await sock.sendMessage(from, { text: text }, { quoted: m });
                    }
                    return; 
                }

                // ==================================================
                // AUDIOS BIENVENIDA / DESPEDIDA
                // ==================================================
                if (command === 'setaudiowelcome') {
                    if (!(await isAdmin())) return;
                    const audioBuffer = await descargarAudio(m);
                    if (!audioBuffer) return sock.sendMessage(from, { text: `❌ Responde a una nota de voz con *.setaudiowelcome*` }, { quoted: m });
                    fs.writeFileSync(path.join(DATA_DIR, `welcome_audio_${from.split('@')[0]}.ogg`), audioBuffer);
                    return sock.sendMessage(from, { text: `✅ Audio de bienvenida guardado.` }, { quoted: m });
                }

                if (command === 'delaudiowelcome') {
                    if (!(await isAdmin())) return;
                    const audioPath = path.join(DATA_DIR, `welcome_audio_${from.split('@')[0]}.ogg`);
                    if (fs.existsSync(audioPath)) fs.unlinkSync(audioPath);
                    return sock.sendMessage(from, { text: `✅ Audio de bienvenida borrado.` }, { quoted: m });
                }

                if (command === 'setaudiobye') {
                    if (!(await isAdmin())) return;
                    const audioBuffer = await descargarAudio(m);
                    if (!audioBuffer) return sock.sendMessage(from, { text: `❌ Responde a una nota de voz con *.setaudiobye*` }, { quoted: m });
                    fs.writeFileSync(path.join(DATA_DIR, `bye_audio_${from.split('@')[0]}.ogg`), audioBuffer);
                    return sock.sendMessage(from, { text: `✅ Audio de despedida guardado.` }, { quoted: m });
                }

                if (command === 'delaudiobye') {
                    if (!(await isAdmin())) return;
                    const audioPath = path.join(DATA_DIR, `bye_audio_${from.split('@')[0]}.ogg`);
                    if (fs.existsSync(audioPath)) fs.unlinkSync(audioPath);
                    return sock.sendMessage(from, { text: `✅ Audio de despedida borrado.` }, { quoted: m });
                }

                // ==================================================
                // MENÚ Y TIENDA
                // ==================================================
                if (command === 'ayuda' || command === 'comandos') {
                    let text = `🤖 *LISTA DE COMANDOS - BOT SAMANTHA*\n\n`;
                    text += `👤 *Públicos:*\n`;
                    text += `• *.menu / .tienda* - Catálogo.\n`;
                    text += `• *.stock* - Cantidades disponibles.\n`;
                    text += `• *.saldo* - Tu saldo actual.\n`;
                    text += `• *.comprar <producto>* - Comprar cuenta (al privado).\n`;
                    text += `• *.pago* - Datos bancarios.\n`;
                    text += `• *.soporte* - Contactar admin.\n\n`;
                    text += `👑 *Administradores:*\n`;
                    text += `• *.ip <ip/dominio>* - Inteligencia OSINT de red.\n`;
                    text += `• *.daradmin / .quitaradmin <@usuario>* - Gestión de admins.\n`;
                    text += `• *.verstock <producto>* - Muestra cuentas con su número de lista.\n`;
                    text += `• *.delstockitem <producto> <número>* - Borra una cuenta específica de la lista.\n`;
                    text += `• *.delstock <producto>* - Vacía todo el stock del producto.\n`;
                    text += `• *.delproducto <producto>* - Elimina el producto completo.\n`;
                    text += `• *.addstock <producto> <datos>* - Agrega inventario.\n`;
                    text += `• *.setprecio <producto> <precio>* - Fija precio.\n`;
                    text += `• *.versaldo / .historial <@usuario>* - Consulta de clientes.\n`;
                    text += `• *.addsaldo / .removesaldo <@usuario> <$>* - Ajuste de saldo.\n`;
                    text += `• *.crearcmd / .delcmd* - Comandos personalizados.\n`;
                    text += `• *.setrecordatorio / .recordatorios* - Alertas automáticas.\n`;
                    text += `• *.welcome / .bye <on/off>* - Avisos grupales.\n`;
                    text += `• *.expulsar <@usuario>* - Banear del grupo.`;
                    await sock.sendMessage(from, { text }, { quoted: m });
                }

                else if (command === 'soporte') {
                    let text = `🛠️ *Soporte*\n\nComunícate con la administración:\n👉 wa.me/521XXXXXXXXXX`;
                    await sock.sendMessage(from, { text }, { quoted: m });
                }

                else if (command === 'versaldo' || command === 'verbalance') {
                    if (!(await isAdmin())) return;
                    const mentioned = m.message.extendedTextMessage?.contextInfo?.mentionedJid?.[0];
                    if (!mentioned) return sock.sendMessage(from, { text: '❌ Etiqueta a la persona.' }, { quoted: m });

                    const base = obtenerNumeroBase(mentioned);
                    let userSaldo = 0;
                    for (const key in db.saldos) {
                        if (obtenerNumeroBase(key) === base) {
                            userSaldo = db.saldos[key];
                            break;
                        }
                    }
                    await sock.sendMessage(from, { text: `💰 Saldo de @${mentioned.split('@')[0]}: $${userSaldo} MXN`, mentions: [mentioned] }, { quoted: m });
                }

                else if (command === 'historial' || command === 'compras') {
                    if (!(await isAdmin())) return;
                    const mentioned = m.message.extendedTextMessage?.contextInfo?.mentionedJid?.[0];
                    if (!mentioned) return sock.sendMessage(from, { text: '❌ Etiqueta a la persona.' }, { quoted: m });

                    const base = obtenerNumeroBase(mentioned);
                    const comprasCliente = (db.ventas || []).filter(v => obtenerNumeroBase(v.comprador) === base);
                    if (comprasCliente.length === 0) return sock.sendMessage(from, { text: `📁 Sin compras registradas.`, mentions: [mentioned] }, { quoted: m });

                    let text = `📜 *COMPRAS DE @${mentioned.split('@')[0]}*\n\n`;
                    comprasCliente.slice(-20).forEach((v, i) => {
                        text += `${i + 1}. *${v.producto.toUpperCase()}* - $${v.precio} MXN\n`;
                    });
                    await sock.sendMessage(from, { text, mentions: [mentioned] }, { quoted: m });
                }

                else if (command === 'expulsar' || command === 'kick') {
                    if (!(await isAdmin())) return;
                    const mentioned = m.message.extendedTextMessage?.contextInfo?.mentionedJid?.[0];
                    if (!mentioned) return sock.sendMessage(from, { text: '❌ Etiqueta al usuario.' }, { quoted: m });
                    try {
                        await sock.groupParticipantsUpdate(from, [mentioned], "remove");
                        await sock.sendMessage(from, { text: '✅ Usuario expulsado.' }, { quoted: m });
                    } catch (e) {
                        await sock.sendMessage(from, { text: '❌ Error. ¿El bot es Admin?' }, { quoted: m });
                    }
                }

                else if (command === 'promocion' || command === 'oferta') {
                    if (!(await isAdmin())) return;
                    let promoText = args.join(' ');
                    if (!promoText) return sock.sendMessage(from, { text: '❌ Escribe el texto.' }, { quoted: m });
                    const metadata = await sock.groupMetadata(from);
                    await sock.sendMessage(from, { text: `🚨 *¡PROMOCIÓN!* 🚨\n\n${promoText}`, mentions: metadata.participants.map(p => p.id) });
                }

                else if (command === 'todo' || command === 'todos') {
                    if (!(await isAdmin())) return;
                    let text = args.length > 0 ? args.join(' ') : '📣 *¡ATENCIÓN!*';
                    const metadata = await sock.groupMetadata(from);
                    await sock.sendMessage(from, { text, mentions: metadata.participants.map(p => p.id) }, { quoted: m });
                }

                else if (command === 'welcome') {
                    if (!(await isAdmin())) return;
                    if (!db.grupos[from]) db.grupos[from] = {};
                    const estado = args[0]?.toLowerCase();
                    if (estado === 'on' || estado === 'off') {
                        db.grupos[from].welcome = (estado === 'on');
                        saveDB(db);
                        await sock.sendMessage(from, { text: `✅ Bienvenidas ${estado.toUpperCase()}` }, { quoted: m });
                    } else {
                        await sock.sendMessage(from, { text: 'Usa: *.welcome on* o *.welcome off*' }, { quoted: m });
                    }
                }

                else if (command === 'bye') {
                    if (!(await isAdmin())) return;
                    if (!db.grupos[from]) db.grupos[from] = {};
                    const estado = args[0]?.toLowerCase();
                    if (estado === 'on' || estado === 'off') {
                        db.grupos[from].bye = (estado === 'on');
                        saveDB(db);
                        await sock.sendMessage(from, { text: `✅ Despedidas ${estado.toUpperCase()}` }, { quoted: m });
                    } else {
                        await sock.sendMessage(from, { text: 'Usa: *.bye on* o *.bye off*' }, { quoted: m });
                    }
                }

                else if (command === 'setwelcome') {
                    if (!(await isAdmin())) return;
                    if (!db.grupos[from]) db.grupos[from] = {};
                    const textoNuevo = args.join(' ');
                    if (textoNuevo) db.grupos[from].welcomeMsg = textoNuevo;
                    const buffer = await descargarImagen(m);
                    if (buffer) fs.writeFileSync(path.join(DATA_DIR, `welcome_${from.split('@')[0]}.jpg`), buffer);
                    saveDB(db);
                    await sock.sendMessage(from, { text: '✅ Bienvenida configurada.' }, { quoted: m });
                }

                else if (command === 'setbye') {
                    if (!(await isAdmin())) return;
                    if (!db.grupos[from]) db.grupos[from] = {};
                    const textoNuevo = args.join(' ');
                    if (textoNuevo) db.grupos[from].byeMsg = textoNuevo;
                    const buffer = await descargarImagen(m);
                    if (buffer) fs.writeFileSync(path.join(DATA_DIR, `bye_${from.split('@')[0]}.jpg`), buffer);
                    saveDB(db);
                    await sock.sendMessage(from, { text: '✅ Despedida configurada.' }, { quoted: m });
                }

                else if (command === 'menu' || command === 'tienda') {
                    let text = `🛒 *MENÚ DE TIENDA*\n\n👤 *Tu Saldo:* $${db.saldos[sender] || 0} MXN\n\n📦 *Productos:*\n`;
                    const productos = Object.keys(db.precios);
                    if (productos.length === 0) text += `_Sin productos._\n`;
                    else {
                        productos.forEach(p => {
                            text += `• *${p.toUpperCase()}* - $${db.precios[p]} MXN (Stock: ${(db.stock[p] || []).length})\n`;
                        });
                    }
                    await sock.sendMessage(from, { text }, { quoted: m });
                }

                else if (command === 'saldo') {
                    await sock.sendMessage(from, { text: `💰 Tu saldo: *$${db.saldos[sender] || 0} MXN*` }, { quoted: m });
                }

                else if (command === 'stock') {
                    let text = `📦 *STOCK DISPONIBLE:*\n\n`;
                    for (const p in db.precios) {
                        text += `• *${p.toUpperCase()}*: ${(db.stock[p] || []).length} disponibles\n`;
                    }
                    await sock.sendMessage(from, { text }, { quoted: m });
                }

                else if (command === 'pago') {
                    await sock.sendMessage(from, { text: `${db.pago || "Sin datos bancarios."}\n\n*PAGOS*` }, { quoted: m });
                }

                else if (command === 'setpago') {
                    if (!(await isAdmin())) return;
                    db.pago = args.join(' ');
                    saveDB(db);
                    await sock.sendMessage(from, { text: `✅ Datos de pago actualizados.` }, { quoted: m });
                }

                else if (command === 'ventas') {
                    if (!(await isAdmin())) return;
                    if (!db.ventas || db.ventas.length === 0) return sock.sendMessage(from, { text: '📈 Sin ventas.' }, { quoted: m });
                    let text = `📈 *ÚLTIMAS VENTAS*\n\n`;
                    db.ventas.slice(-30).forEach((v, i) => {
                        text += `${i + 1}. *${v.producto.toUpperCase()}* - $${v.precio} MXN (👤 @${v.comprador.split('@')[0]})\n`;
                    });
                    await sock.sendMessage(from, { text, mentions: db.ventas.map(v => v.comprador) }, { quoted: m });
                }

                else if (command === 'abrir' || command === 'cerrar') {
                    if (!(await isAdmin())) return;
                    try {
                        await sock.groupSettingUpdate(from, command === 'abrir' ? 'not_announcement' : 'announcement');
                        await sock.sendMessage(from, { text: `✅ Grupo ${command}` }, { quoted: m });
                    } catch (e) {
                        await sock.sendMessage(from, { text: '❌ Error. ¿El bot es Admin?' }, { quoted: m });
                    }
                }

                // ==================================================
                // COMPRA (ENTREGA AL PRIVADO)
                // ==================================================
                else if (command === 'comprar') {
                    const producto = args[0]?.toLowerCase();
                    if (!producto || !db.precios[producto]) return sock.sendMessage(from, { text: `❌ Producto no válido.` }, { quoted: m });
                    
                    const precio = db.precios[producto];
                    if ((db.saldos[sender] || 0) < precio) return sock.sendMessage(from, { text: `❌ Saldo insuficiente.` }, { quoted: m });
                    if (!db.stock[producto] || db.stock[producto].length === 0) return sock.sendMessage(from, { text: `❌ Producto agotado.` }, { quoted: m });

                    db.saldos[sender] -= precio;
                    const cuentaEntregada = db.stock[producto].shift();

                    const mensajePrivado = `🎉 *¡COMPRA EXITOSA!*\n\n📦 *Producto:* ${producto.toUpperCase()}\n💵 *Costo:* $${precio} MXN\n💰 *Saldo restante:* $${db.saldos[sender]} MXN\n\n🔑 *Tus Credenciales:*\n${cuentaEntregada}`;

                    try {
                        await sock.sendMessage(sender, { text: mensajePrivado });
                        if (!db.ventas) db.ventas = [];
                        db.ventas.push({ comprador: sender, producto: producto, precio: precio, fecha: new Date().toISOString() });
                        saveDB(db);

                        if (isGroup) {
                            await sock.sendMessage(from, {
                                text: `✅ @${sender.split('@')[0]} ¡Compra de *${producto.toUpperCase()}* exitosa!\n📩 Credenciales enviadas a tu *chat privado*.`,
                                mentions: [sender]
                            }, { quoted: m });
                        }
                    } catch (err) {
                        db.saldos[sender] += precio;
                        db.stock[producto].unshift(cuentaEntregada);
                        saveDB(db);
                        await sock.sendMessage(from, { text: `❌ No pude enviarte el mensaje privado (revisa si tienes bloqueado al bot). Tu saldo fue devuelto.` }, { quoted: m });
                    }
                }

                else if (command === 'addsaldo') {
                    if (!(await isAdmin())) return;
                    const mentioned = m.message.extendedTextMessage?.contextInfo?.mentionedJid?.[0];
                    const monto = parseInt(args[1] || args[0]);
                    if (!mentioned || isNaN(monto)) return;
                    db.saldos[mentioned] = (db.saldos[mentioned] || 0) + monto;
                    saveDB(db);
                    await sock.sendMessage(from, { text: `✅ Saldo sumado.`, mentions: [mentioned] }, { quoted: m });
                }

                else if (command === 'removesaldo') {
                    if (!(await isAdmin())) return;
                    const mentioned = m.message.extendedTextMessage?.contextInfo?.mentionedJid?.[0];
                    const monto = parseInt(args[1] || args[0]);
                    if (!mentioned || isNaN(monto)) return;
                    db.saldos[mentioned] = Math.max((db.saldos[mentioned] || 0) - monto, 0);
                    saveDB(db);
                    await sock.sendMessage(from, { text: `✅ Saldo descontado.`, mentions: [mentioned] }, { quoted: m });
                }

                else if (command === 'addstock') {
                    if (!(await isAdmin())) return;
                    const producto = args[0]?.toLowerCase();
                    const cuenta = args.slice(1).join(' ');
                    if (!producto || !cuenta) return;
                    if (!db.stock[producto]) db.stock[producto] = [];
                    db.stock[producto].push(cuenta);
                    saveDB(db);
                    await sock.sendMessage(from, { text: `✅ Cuenta agregada al stock de ${producto.toUpperCase()}.` }, { quoted: m });
                }

                else if (command === 'delstock') {
                    if (!(await isAdmin())) return;
                    const producto = args[0]?.toLowerCase();
                    if (!db.stock[producto]) return sock.sendMessage(from, { text: '❌ Producto no encontrado.' }, { quoted: m });
                    db.stock[producto] = [];
                    saveDB(db);
                    await sock.sendMessage(from, { text: `✅ Stock de *${producto.toUpperCase()}* vaciado por completo.` }, { quoted: m });
                }

                else if (command === 'delproducto') {
                    if (!(await isAdmin())) return;
                    const producto = args[0]?.toLowerCase();
                    if (!producto || (!db.precios[producto] && !db.stock[producto])) {
                        return sock.sendMessage(from, { text: '❌ El producto no existe.' }, { quoted: m });
                    }
                    delete db.precios[producto];
                    delete db.stock[producto];
                    saveDB(db);
                    await sock.sendMessage(from, { text: `🗑️ Producto *${producto.toUpperCase()}* eliminado por completo.` }, { quoted: m });
                }

                else if (command === 'setprecio') {
                    if (!(await isAdmin())) return;
                    const producto = args[0]?.toLowerCase();
                    const precio = parseInt(args[1]);
                    if (!producto || isNaN(precio)) return;
                    db.precios[producto] = precio;
                    if (!db.stock[producto]) db.stock[producto] = [];
                    saveDB(db);
                    await sock.sendMessage(from, { text: `✅ Precio de ${producto.toUpperCase()} fijado en $${precio}.` }, { quoted: m });
                }

            } catch (error) { console.error('❌ ERROR PROCESANDO MENSAJE:', error); }
        });

        botStarting = false;
    } catch (error) {
        botStarting = false;
        console.error('🔥 ERROR INICIANDO BAILEYS', error);
        setTimeout(() => { startBot(); }, 10000);
    }
}

startBot();