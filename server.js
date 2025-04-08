const express = require('express');
const basicAuth = require('express-basic-auth');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcrypt');
const crypto = require('crypto');
const bodyParser =  require('body-parser');
const path = require('path');
require('dotenv').config()


const app = express();

// Middleware to parse JSON bodies
app.use(bodyParser.json());

// Serve static files from the "public" directory
app.use(express.static(path.join(__dirname, 'public')));

const PORT = process.env.PORT || 3000;
const SECRET_KEY = process.env.SECRET_KEY || 'your_secret_key';

const DB_HOST = process.env.DB_HOST || '127.0.0.1';
const DB_PORT = process.env.DB_PORT || 3306;
const DB_USER = process.env.DB_USER || 'root';
const DB_PASSWORD = process.env.DB_PASSWORD || '';
const DB_DATABASE = process.env.DB_DATABASE || 'drugstore';

var mysql      = require('mysql-await');
const { error } = require('console');
const { isNumber } = require('util');
var connection = mysql.createConnection({
  host     : DB_HOST,
  port     : DB_PORT,
  user     : DB_USER,
  password : DB_PASSWORD,
  database : DB_DATABASE,
  insecureAuth : true
});

// Basic authentication setup for the /token route
const authMiddleware = basicAuth({
    authorizer: myAuthorizer,
    authorizeAsync: true
});

connection.on(`error`, (err) => {
    console.error(`Connection error ${err.code}`);
});


function generatePassword(password, salt) {
    if (!salt) {
        salt = crypto.randomBytes(32).toString('hex')
    }
    const genHash = crypto.pbkdf2Sync(password, salt, 10000, 64, 'sha512').toString('hex')
    return {
        salt: salt,
        hash: genHash
    }
}

function validPassword(password, hash, salt) {
    const checkHash = generatePassword(password, salt);
    return hash === checkHash.hash;
}

async function myAuthorizer(username, password, cb) {
    const initPwd = generatePassword(password);
    //console.log(initPwd);
    var query = 'SELECT password, salt, locked, failedAttempts FROM users WHERE login = ?';
    var results = await connection.awaitQuery(query, [username]);
    if (results && results.length) {
        var failedAttempts = results[0].failedAttempts + 1;
        var locked = results[0].locked;
        if (!locked && validPassword(password, results[0].password, results[0].salt)) {
            query = 'UPDATE users SET locked = 0, failedAttempts = 0, lastLogin = UTC_TIMESTAMP() WHERE login = ?';
            await connection.awaitQuery(query, [username]);
            return cb(null, true);
        }
        locked = failedAttempts >= 5;
        query = 'UPDATE users SET locked = ?, failedAttempts = ?, lastLogin = UTC_TIMESTAMP() WHERE login = ?';
        await connection.awaitQuery(query, [locked, failedAttempts, username]);
    }
    return cb(null, false);
}

async function mapResultsToEntryObject(records, columnId) {
    var results = {};
    records.forEach(element => {
        results[element[columnId]] = element;
    });
    return results;
}

async function getWebsites() {
    var sites = await connection.awaitQuery("SELECT id, name, url, zipcode FROM websites");
    return await mapResultsToEntryObject(sites, 'id');

}

async function executeSearch(q) {

    if (!q || q.length < 5) {
        throw error('please provide 5 chars to query');
    }

    var parameters = [];
    var whereText = "";
    var OrderByText = " ORDER BY P.price ASC";
    var sqlQuery = "SELECT P.websiteId ,P.UPC ,P.name, P.price, P.listPrice, P.promotionInfo, P.strikeOff, P.available, P.path, P.downloadDateUTC \r\n"
        + "FROM prices AS P \r\n"
        + "INNER JOIN websites AS W ON (P.websiteId = W.id AND P.zipCode = W.zipCode) \r\n"
        //+ " \r\n"

    if (typeof q === 'number') {
        whereText = "WHERE P.UPC LIKE ?";
        parameters.push('%'+q+'%');
    } else {
        parameters = q.split(' ').map(p => '%'+p+'%');
        whereText = "WHERE " + parameters.map(p => 'P.name LIKE ?').join(' AND ');
    }

    return await connection.awaitQuery(sqlQuery + whereText + OrderByText, parameters);
}


// Route to generate JWT token
app.post('/token', authMiddleware,  (req, res) => {
    const user = req.auth.user;
    const token = jwt.sign({ username: user }, SECRET_KEY, { expiresIn: '1d' });
    res.json({ token });
});

// Protected route example
app.post('/search', async (req, res) => {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];
    const queryText = req.body.query;
    var sites = {
        order : []
    };
    var result = {
        sites: []
    }

    if (!token) {
        //return res.status(401).json({ message: 'Access token is missing or invalid' });
    }

    if (!queryText) {
        return res.sendStatus(400).json({error: 'Query text is required'});
    }

    if (queryText.length < 5) {
        return res.sendStatus(400).json({error: 'Query text must be at least 5 characters'});
    }

    var prices = await executeSearch(queryText);
    if (prices.length) {
        var websites = await getWebsites();

        prices.forEach(p => {
            var website = websites[p.websiteId];
            if (!(p.websiteId in sites)) {
                sites.order.push(p.websiteId);
                sites[p.websiteId] = {
                    drugStoreName: website.name,
                    drugStoreNameUrl: website.url,
                    products:[]
                }
            }
            //TODO remove attributes from p in case is not logged in
            sites[p.websiteId].products.push(p);
        });
    }
    
    sites.order.forEach(key => {
        result.sites.push(sites[key]);
    })
    res.json(result);
});

// Protected route example
app.get('/protected', (req, res) => {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];

    if (!token) {
        return res.status(401).json({ message: 'Access token is missing or invalid' });
    }

    jwt.verify(token, SECRET_KEY, (err, user) => {
        if (err) {
            return res.status(403).json({ message: 'Token is not valid' });
        }
        res.json({ message: 'This is a protected route', user });
    });
});


app.listen(PORT, () => {
    console.log(`Server is running on http://localhost:${PORT}`);
});