const express = require('express');
const { GoogleSpreadsheet } = require('google-spreadsheet');
const { JWT } = require('google-auth-library');
const axios = require('axios'); // 👈 Required for sending messages

const app = express();
app.use(express.json());

const port = process.env.PORT || 3000;
const verifyToken = process.env.VERIFY_TOKEN;

// Environment Variables
const SHEET_ID = process.env.SHEET_ID;
const GOOGLE_CLIENT_EMAIL = process.env.GOOGLE_CLIENT_EMAIL;
// Handle potential newline characters in private key
const GOOGLE_PRIVATE_KEY = process.env.GOOGLE_PRIVATE_KEY ? process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, '\n') : '';
const WHATSAPP_TOKEN = process.env.WHATSAPP_TOKEN;
const PHONE_NUMBER_ID = process.env.PHONE_NUMBER_ID;

// 1. Message Sending Function (Reply)
async function sendReply(toPhone, text) {
    try {
        await axios({
            method: 'POST',
            url: `https://graph.facebook.com/v21.0/${PHONE_NUMBER_ID}/messages`,
            headers: {
                'Authorization': `Bearer ${WHATSAPP_TOKEN}`,
                'Content-Type': 'application/json',
            },
            data: {
                messaging_product: 'whatsapp',
                to: toPhone,
                type: 'text',
                text: { body: text }
            }
        });
        console.log(`Reply sent to ${toPhone}`);
    } catch (e) {
        console.error('Error sending reply:', e.response ? e.response.data : e.message);
    }
}

// 2. Google Sheet Function
async function appendToSheet(phone, message, name) {
    try {
        const serviceAccountAuth = new JWT({
            email: GOOGLE_CLIENT_EMAIL,
            key: GOOGLE_PRIVATE_KEY,
            scopes: ['https://www.googleapis.com/auth/spreadsheets'],
        });

        const doc = new GoogleSpreadsheet(SHEET_ID, serviceAccountAuth);
        await doc.loadInfo();
        const sheet = doc.sheetsByIndex[0];

        await sheet.addRow({
            Time: new Date().toLocaleString(),
            Name: name,
            Phone: phone,
            Type: 'text',
            Message: message
        });

        console.log('Row added to sheet!');
    } catch (error) {
        console.error('Sheet Error:', error);
    }
}

// Routes
app.get('/', (req, res) => {
    const { 'hub.mode': mode, 'hub.challenge': challenge, 'hub.verify_token': token } = req.query;
    if (mode === 'subscribe' && token === verifyToken) {
        res.status(200).send(challenge);
    } else {
        res.status(403).end();
    }
});

app.post('/', async (req, res) => {
    res.status(200).end(); // Respond to WhatsApp immediately

    try {
        const body = req.body;
        if (body.object) {
            if (
                body.entry &&
                body.entry[0].changes &&
                body.entry[0].changes[0].value.messages &&
                body.entry[0].changes[0].value.messages[0]
            ) {
                const messageData = body.entry[0].changes[0].value.messages[0];
                const contactData = body.entry[0].changes[0].value.contacts[0];

                const senderPhone = messageData.from;
                const senderName = contactData.profile.name;

                if (messageData.type === 'text') {
                    const textMessage = messageData.text.body;
                    console.log(`New Message from ${senderName}: ${textMessage}`);

                    // 1. Save to Sheet
                    await appendToSheet(senderPhone, textMessage, senderName);

                    // 2. Auto-Reply Logic (Only Welcome Message)
                    // Check for "salam", "hi" or "hello"
                    const lowerText = textMessage.toLowerCase();

                    if (lowerText.includes("salam") || lowerText.includes("hi") || lowerText.includes("hello")) {
                        await sendReply(senderPhone, "خوش آمدید! 🌹\nہماری سروس میں آپ کا استقبال ہے۔");
                        await sendReply(senderPhone, "براہِ کرم مطلوبہ آپشن کا اندراج کریں:\n\n1️⃣. سیل مین سے متعلق شکایت\n2️⃣. ڈسٹری بیوٹر سے متعلق شکایت\n3️⃣. سٹاک کی کوالٹی/ قیمت یا بل کے متعلق شکایت\n4️⃣. سٹاک آرڈر");
                    }
                }
            }
        }
    } catch (e) {
        console.log('Error:', e);
    }
});

app.listen(port, () => {
    console.log(`Listening on port ${port}`);
});
