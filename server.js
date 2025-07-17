// server.js
// This is the backend server for your WhatsApp Automation tool.
// It uses Express to serve the web page, Socket.IO for real-time communication,
// and whatsapp-web.js to interact with WhatsApp.

const { Client, LocalAuth } = require('whatsapp-web.js');
const express = require('express');
const http = require('http');
const { Server } = require("socket.io");
const qrcode = require('qrcode');
const fs = require('fs'); // Required for file system operations to delete session files

// --- Basic Server Setup ---
const app = express();
const server = http.createServer(app);
const io = new Server(server);
const PORT = 3000;

// Serve static files (like your new script.js) from a 'public' directory
app.use(express.static('public'));

// Serve the frontend HTML file
app.get('/', (req, res) => {
    res.sendFile(__dirname + '/index.html');
});

console.log(`[SERVER] Starting server on http://localhost:${PORT}`);

// --- WhatsApp Client Setup ---
const client = new Client({
    authStrategy: new LocalAuth(),
    // Puppeteer options are important for running on servers or in containers
    puppeteer: {
        headless: true,
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-accelerated-2d-canvas',
            '--no-first-run',
            '--no-zygote',
            '--single-process', // <- this one doesn't works in Windows
            '--disable-gpu'
        ],
    },
});

console.log('[WHATSAPP] Initializing client...');
client.initialize();

// --- Global variables to store current contacts and scheduled jobs ---
let currentContacts = [];
const scheduledJobs = {}; // Stores timeouts for agenda messages {jobId: {timeoutId: ..., agendaItem: ...}}

// --- Socket.IO Connection Handling ---
io.on('connection', (socket) => {
    console.log('[SOCKET] A user connected');

    // Emit initial status
    socket.emit('log', 'Welcome! Waiting for client to initialize...');
    socket.emit('status', { message: 'Initializing...', color: 'yellow' });

    // Event: Generate and send QR code
    client.on('qr', (qr) => {
        console.log('[WHATSAPP] QR Code received');
        qrcode.toDataURL(qr, (err, url) => {
            if (err) {
                console.error('[QR] Error generating QR code:', err);
                socket.emit('log', 'Error generating QR code.');
                socket.emit('status', { message: 'Error', color: 'red' });
            } else {
                socket.emit('qr', url);
                socket.emit('log', 'QR Code generated. Please scan it with your phone.');
                socket.emit('status', { message: 'Scan QR Code', color: 'blue' });
            }
        });
    });

    // Event: WhatsApp client is ready
    client.on('ready', () => {
        console.log('[WHATSAPP] Client is ready!');
        socket.emit('log', '✅ WhatsApp client is ready and connected. It will remain logged in.');
        socket.emit('status', { message: 'Ready', color: 'green' });
        socket.emit('ready'); // Signal frontend to enable buttons etc.
        // Also send summary of currently scheduled jobs if any exist
        const activeAgenda = Object.values(scheduledJobs).map(job => job.agendaItem);
        if (activeAgenda.length > 0) {
            socket.emit('agenda-scheduled-summary', activeAgenda);
        }
    });

    // Event: WhatsApp client disconnected
    client.on('disconnected', (reason) => {
        console.log('[WHATSAPP] Client was logged out', reason);
        socket.emit('log', '❌ WhatsApp client disconnected. Please scan a new QR code to log back in.');
        socket.emit('status', { message: 'Disconnected', color: 'red' });
        // Clear all scheduled jobs if client disconnects
        clearAllScheduledJobs(socket);
        io.emit('agenda-scheduled-summary', []); // Clear summary on frontend
        // The client will try to re-initialize and generate a new QR code automatically
        client.initialize(); 
    });

    // Listen for the 'start-automation' event from the frontend (for immediate campaigns)
    socket.on('start-automation', async (data) => {
        console.log('[AUTOMATION] Received start signal with data:', data);
        const { contacts, messageTemplate } = data;

        if (!contacts || !messageTemplate) {
            socket.emit('log', '❌ Error: Contacts or message template is missing.');
            socket.emit('ready'); // Re-enable buttons if error
            return;
        }

        currentContacts = contacts; // Store contacts for agenda use
        await runAutomation(socket, contacts, messageTemplate);
        // After automation, re-enable buttons on frontend
        socket.emit('ready'); // Re-emit ready to enable buttons
    });

    // Listen for the 'schedule-agenda' event from the frontend
    socket.on('schedule-agenda', async (data) => {
        console.log('[AGENDA] Received agenda scheduling data:', data);
        const { contacts, agenda } = data;

        if (!contacts || contacts.length === 0) {
            socket.emit('log', '❌ Error: No contacts provided for agenda scheduling. Please fill in the contacts section.');
            socket.emit('ready'); // Re-enable buttons
            return;
        }
        if (!agenda || agenda.length === 0) {
            socket.emit('log', '❌ Error: No agenda events provided for scheduling.');
            socket.emit('ready'); // Re-enable buttons
            return;
        }

        currentContacts = contacts; // Store contacts for agenda use

        socket.emit('log', '🗓️ Clearing previous agenda schedules...');
        clearAllScheduledJobs(socket); // Clear any existing schedules before setting new ones

        socket.emit('log', `🗓️ Scheduling ${agenda.length} agenda messages...`);
        socket.emit('status', { message: 'Scheduling Agenda...', color: 'blue' });

        const scheduledEventsForSummary = [];

        for (const item of agenda) {
            const { date, time, message } = item;
            const scheduledDateTime = new Date(`${date}T${time}:00`);
            const now = new Date();

            if (scheduledDateTime <= now) {
                socket.emit('log', `⚠️ Skipping past event for ${date} ${time}.`);
                continue;
            }

            const delayMs = scheduledDateTime.getTime() - now.getTime();
            const jobId = `agenda-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`; // Unique ID for the job

            // Store the agenda item with the job ID for summary purposes
            scheduledJobs[jobId] = {
                timeoutId: setTimeout(async () => {
                    socket.emit('log', `⏰ Sending scheduled message for ${date} ${time}...`);
                    if (client.info) { // Only send if client is still logged in
                        await sendPersonalizedMessages(socket, currentContacts, message);
                    } else {
                        socket.emit('log', `⚠️ Client not logged in. Message for ${date} ${time} not sent.`);
                    }
                    // After execution, remove from scheduledJobs and potentially update frontend summary
                    delete scheduledJobs[jobId]; 
                    // Optional: Re-emit agenda-scheduled-summary to update the list, showing only remaining events
                    io.emit('agenda-scheduled-summary', Object.values(scheduledJobs).map(job => job.agendaItem));
                }, delayMs),
                agendaItem: item // Store the original agenda item for the summary
            };
            scheduledEventsForSummary.push(item); // Add to a temporary list for immediate summary

            socket.emit('log', `✅ Scheduled message for ${date} ${time}. (Will send in approx. ${Math.ceil(delayMs / 1000 / 60)} minutes)`);
        }
        socket.emit('log', '🎉 All agenda messages have been scheduled!');
        socket.emit('status', { message: 'Agenda Scheduled', color: 'green' });
        socket.emit('ready'); // Re-enable buttons after scheduling

        // Emit the final list of scheduled events to the frontend
        io.emit('agenda-scheduled-summary', scheduledEventsForSummary);
    });


    // Listen for a manual session reset from the client
    socket.on('reset-session', async () => {
        console.log('[WHATSAPP] Manual session reset requested.');
        socket.emit('log', 'Manual reset requested. Logging out...');
        socket.emit('status', { message: 'Resetting...', color: 'yellow' });
        
        // Clear all scheduled jobs
        clearAllScheduledJobs(socket);
        io.emit('agenda-scheduled-summary', []); // Clear summary on frontend

        // Destroy the client instance and delete session files
        if (client) {
            try {
                await client.destroy();
                console.log('[WHATSAPP] Client destroyed.');
            } catch (error) {
                console.error('[WHATSAPP] Error destroying client:', error);
                socket.emit('log', 'Error during client destruction.');
            }
        }
        
        // Delete the session files to ensure a clean slate
        const sessionPath = './.wwebjs_auth/session'; // Default path for LocalAuth
        if (fs.existsSync(sessionPath)) {
            fs.rm(sessionPath, { recursive: true, force: true }, (err) => {
                if (err) {
                    console.error('[WHATSAPP] Error deleting session files:', err);
                    socket.emit('log', 'Error deleting old session files. Manual cleanup might be needed.');
                } else {
                    console.log('[WHATSAPP] Old session files deleted.');
                    socket.emit('log', 'Old session files deleted. Re-initializing...');
                }
                // Re-initialize the client to get a new QR code
                client.initialize();
            });
        } else {
            console.log('[WHATSAPP] No session files found to delete. Re-initializing...');
            client.initialize();
        }
    });

    socket.on('disconnect', () => {
        console.log('[SOCKET] User disconnected');
        // Note: We don't clear jobs on simple disconnect, only on client.disconnected or manual reset
        // The WhatsApp client itself handles persistent login, so server restart or UI close
        // won't log out the WhatsApp client unless session files are deleted or client disconnects from WhatsApp side.
    });
});

// --- Helper to clear all scheduled jobs ---
function clearAllScheduledJobs(socket) {
    for (const jobId in scheduledJobs) {
        clearTimeout(scheduledJobs[jobId].timeoutId); // Clear the actual timeout
        delete scheduledJobs[jobId];
    }
    socket.emit('log', 'All pending agenda schedules cleared.');
    console.log('[AGENDA] All pending agenda schedules cleared.');
}

// --- Automation Logic (for immediate campaigns) ---
async function runAutomation(socket, contacts, messageTemplate) {
    socket.emit('log', '🚀 Starting immediate campaign process...');
    socket.emit('status', { message: 'Sending Campaign...', color: 'blue' });

    if (client.info) { // Check if client is still logged in before sending
        await sendPersonalizedMessages(socket, contacts, messageTemplate);
    } else {
        socket.emit('log', '⚠️ WhatsApp client not logged in. Cannot send immediate campaign.');
    }

    const finalMsg = '🎉 Immediate campaign processing finished! Client remains connected.';
    console.log(finalMsg);
    socket.emit('log', finalMsg);
    socket.emit('status', { message: 'Campaign Finished', color: 'green' });
}

// --- Generic function to send personalized messages to a list of contacts ---
async function sendPersonalizedMessages(socket, contacts, messageTemplate) {
    function delay(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    function getRandomDelay(min = 4000, max = 8000) {
        return Math.floor(Math.random() * (max - min + 1)) + min;
    }

    for (const contact of contacts) {
        const { name, phone } = contact;

        if (!phone || !name) {
            const warning = `⚠️ Skipping invalid contact: ${JSON.stringify(contact)}`;
            console.warn(warning);
            socket.emit('log', warning);
            continue;
        }

        // Sanitize phone number (ensure country code, remove special chars)
        let fullPhone = phone.toString().replace(/[^0-9]/g, '');
        // Assuming India's country code (91) if a 10-digit number is provided without it
        if (fullPhone.startsWith('91') && fullPhone.length > 10) {
             // Already has country code, do nothing
        } else if (fullPhone.length === 10) {
            fullPhone = '91' + fullPhone; // Prepend Indian country code
        } else {
            const warning = `⚠️ Skipping invalid phone number for ${name}: ${phone} (Does not look like a valid Indian number)`;
            console.warn(warning);
            socket.emit('log', warning);
            continue;
        }

        const message = messageTemplate.replace(/{name}/g, name);
        const chatId = `${fullPhone}@c.us`;

        try {
            await client.sendMessage(chatId, message);
            const successMsg = `✅ Sent to ${name} (${phone})`;
            console.log(successMsg);
            socket.emit('log', successMsg);
        } catch (err) {
            const errorMsg = `❌ Failed for ${name} (${phone}): ${err.message}`;
            console.error(errorMsg);
            socket.emit('log', errorMsg);
        }

        const waitTime = getRandomDelay();
        const waitMsg = `⏳ Waiting ${waitTime / 1000}s before next message...`;
        console.log(waitMsg);
        socket.emit('log', waitMsg);
        await delay(waitTime);
    }
}


// --- Start Server ---
server.listen(PORT, () => {
    console.log(`[SERVER] Web UI available at http://localhost:${PORT}`);
});