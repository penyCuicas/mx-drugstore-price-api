const mysql = require('mysql2/promise');
const config = require('config');
require('dotenv').config();

const pool = mysql.createPool({
    host: process.env.DB_HOST,
    port: process.envDB_PORT,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_DATABASE,
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0
});

async function mapResultsToEntryObject(records, columnId) {
    var results = {};
    records.forEach(element => {
        results[element[columnId]] = element;
    });
    return results;
}

class DbHandler {
    // Obtener un usuario por nombre de usuario
    static async getUserByLogin(username) {
        var [rows] = await pool.execute(
            'SELECT * FROM users WHERE login = ?',
            [username]
        );
        return rows[0]; // Devuelve el primer resultado o undefined
    }

    // Aquí podrías añadir más métodos como crear usuario, actualizar, etc.
    static async updateLoginFailedAttempt(username, failedAttempts, isLocked) {
        await pool.execute(
            'UPDATE users SET locked = ?, failedAttempts = ?, lastLogin = UTC_TIMESTAMP() WHERE login = ?',
            [isLocked, failedAttempts, username]
        );
        return true;
    }

    static async createUser(email, password, salt, username) {
        const verificationToken = require('crypto').randomBytes(32).toString('hex');
        console.log([username, password, salt, email, verificationToken, false]);
        const [result] = await pool.execute(
            'INSERT INTO users (userName, password, salt, login, verificationToken, isVerified) VALUES (?, ?, ?, ?, ?, ?)',
            [username, password, salt, email, verificationToken, false]
        );
        return verificationToken;
    }

    static async verifyUser(token) {
        const hoursOfFreePremiumAccount = config.get('preferences.hoursOfFreePremiumAccount');
        const [rows] = await pool.execute(
            'UPDATE users SET isVerified = TRUE, verificationToken = NULL, validUntil = DATE_ADD(CURRENT_TIMESTAMP, INTERVAL ? HOUR) WHERE verificationToken = ? AND isVerified = FALSE',
            [hoursOfFreePremiumAccount, token]
        );
        return rows.affectedRows > 0;
    }

    static async getUserByToken(token) {
        const [rows] = await pool.execute(
            'SELECT * FROM users WHERE verificationToken = ?',
            [token]
        );
        return rows[0];
    }

    static async getWebsites() {
        var [rows] = await pool.execute(
            'SELECT * FROM websites'
        );
        return await mapResultsToEntryObject(rows, 'id');
    }

    static async getSubscriptions(userId) {
        var [rows] = await pool.execute(
            'SELECT * FROM subscriptions WHERE userId = ? ORDER BY creationDate DESC', [userId]
        );
        return rows;
    }

    static async createSubscription(data) {
        var [rows] = await pool.execute(
            'INSERT INTO subscriptions (userId, stripeSubscriptionId, status, planName, currentPeriodEnd) VALUES (?, ?, ?, ?, FROM_UNIXTIME(?)) ON DUPLICATE KEY UPDATE status = VALUES(status), currentPeriodEnd = VALUES(currentPeriodEnd)',
            [data.userId, data.stripeSubscriptionId, data.status, data.planName, data.currentPeriodEnd]
        );

        //we also update the user table
        [rows] = await pool.execute(
            'UPDATE users SET validUntil = FROM_UNIXTIME(?) WHERE id = ?',
            [data.currentPeriodEnd, data.userId]
        );
        return rows;
    }

    static async executeProductSearch(q) {

        if (!q || q.length < 5) {
            throw error('please provide 5 chars to query');
        }

        var parameters = [];
        var whereText = "";
        var OrderByText = " ORDER BY P.price ASC";
        var sqlQuery = "SELECT P.websiteId ,P.UPC ,P.name, P.price, P.listPrice, P.promotionInfo, P.strikeOff, P.available, P.path, P.downloadDateUTC \r\n" +
            "FROM prices AS P \r\n" +
            "INNER JOIN websites AS W ON (P.websiteId = W.id AND P.zipCode = W.zipCode) \r\n"
        //+ " \r\n"

        if (typeof q === 'number') {
            whereText = "WHERE P.UPC LIKE ?";
            parameters.push('%' + q + '%');
        } else {
            parameters = q.split(' ').map(p => '%' + p + '%');
            whereText = "WHERE " + parameters.map(p => 'P.name LIKE ?').join(' AND ');
        }

        var [rows] = await pool.execute(
            sqlQuery + whereText + OrderByText,
            parameters
        );

        return rows;
    }


}

module.exports = DbHandler;