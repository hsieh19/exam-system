
const db = require('./src/db/db-adapter');
const bcrypt = require('bcryptjs');

async function resetAdmin() {
    try {
        await db.initDatabase();
        const adminUsername = process.env.INITIAL_ADMIN_USERNAME || 'admin';
        const adminPassword = process.env.INITIAL_ADMIN_PASSWORD || 'admin123';
        
        console.log(`Resetting password for user: ${adminUsername}`);
        
        const admin = await db.getUserByUsername(adminUsername);
        if (!admin) {
            console.error(`User ${adminUsername} not found.`);
            process.exit(1);
        }
        
        await db.changePassword(admin.id, adminPassword);
        
        console.log(`Successfully reset ${adminUsername} password to ${adminPassword} and set isFirstLogin=0`);
        process.exit(0);
    } catch (err) {
        console.error('Reset failed:', err);
        process.exit(1);
    }
}

resetAdmin();
