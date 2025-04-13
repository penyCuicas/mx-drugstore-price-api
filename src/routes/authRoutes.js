const express = require('express');
const basicAuth = require('express-basic-auth');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const nodemailer = require('nodemailer');
const dbHandler = require('../db/dbHandler');
const router = express.Router();
require('dotenv').config()

// Configurar nodemailer
const transporter = nodemailer.createTransport({
    host: process.env.EMAIL_HOST,
    port: process.env.EMAIL_PORT,
    secure: false, // true para 465, false para otros puertos
    auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS
    }
});

// Middleware para verificar si el usuario está autenticado
function isAuthenticated(req, res, next) {
    if (req.session && req.session.user) {
        return next();
    }
    res.status(401).json({
        error: 'Debes iniciar sesión primero'
    });
}


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

async function doLogin(username, password) {
    const initPwd = generatePassword(password);
    //console.log(initPwd);
    var user = await dbHandler.getUserByLogin(username);
    if (user) {
        var failedAttempts = user.failedAttempts + 1;
        var locked = user.locked;
        if (!locked && validPassword(password, user.password, user.salt)) {
            await dbHandler.updateLoginFailedAttempt(username, 0, 0);
            return true
        }
        locked = failedAttempts >= 5;
        await dbHandler.updateLoginFailedAttempt(username, failedAttempts, locked);
    }
    return false;
}

function validPassword(password, hash, salt) {
    const checkHash = generatePassword(password, salt);
    return hash === checkHash.hash;
}

async function myAuthorizer(username, password, cb) {
    return cb(null, await doLogin(username, password));
}

// Basic authentication setup for the /token route
const authMiddleware = basicAuth({
    authorizer: myAuthorizer,
    authorizeAsync: true
});

// Route to generate JWT token
router.post('/token', authMiddleware, (req, res) => {
    const user = req.auth.user;
    const token = jwt.sign({
        username: user
    }, process.env.SESSION_SECRET, {
        expiresIn: '1d'
    });
    res.json({
        token
    });
});

// Ruta de login
router.post('/login', async (req, res) => {
    const {
        username,
        password
    } = req.body;

    try {
        const user = await dbHandler.getUserByLogin(username);
        if (!user) {
            return res.status(401).json({
                error: 'Credenciales incorrectas'
            });
        }

        //const initPwd = generatePassword(password);
        //console.log(initPwd);
        var passwordMatch = await doLogin(username, password);
        if (passwordMatch) {
            req.session.user = {
                username: user.userName,
                email: username,
                id: user.id
            };
            //return res.redirect('/');
            //res.render('main', { title: 'Bienvenido' });
            res.json({})
            return;
        }
        //res.redirect('/login');
        res.status(401).json({
            error: 'Credenciales incorrectas'
        });
    } catch (error) {
        console.error('Error en login:', error);
        res.status(500).json({
            error: 'Error interno del servidor'
        });
    }
});


// Ruta de logout
router.post('/logout', isAuthenticated, (req, res) => {
    if (req.session) {
        req.session.destroy((err) => {
            if (err) {
                return res.status(500).json({
                    error: 'Error al cerrar sesión'
                });
            }
            return res.redirect('/');
        });
    }
});

// Ruta para verificar estado de sesión
router.get('/status', (req, res) => {
    if (req.session && req.session.user) {
        return res.json({
            loggedIn: true,
            user: req.session.user
        });
    }
    res.json({
        loggedIn: false
    });
});


router.post('/register', async (req, res) => {
    const {
        username,
        password,
        confirmPassword,
        name
    } = req.body;

    try {

        // Validar que las contraseñas coincidan
        if (password !== confirmPassword) {
            //return res.render('register', { title: 'Crear Cuenta', error: 'Las contraseñas no coinciden' });
            res.status(401).json({
                error: 'Las contraseñas no coinciden'
            });
        }

        const existingUser = await dbHandler.getUserByLogin(username);
        if (existingUser) {
            //return res.render('register', { title: 'Crear Cuenta', error: 'El usuario ya existe' });
            res.status(401).json({
                error: 'El email ya existe'
            });
        }

        const initPwd = generatePassword(password);
        const verificationToken = await dbHandler.createUser(username, initPwd.hash, initPwd.salt, name);
        const verificationLink = `${process.env.APP_URL}/verify/${verificationToken}`;

        await transporter.sendMail({
            from: `"Farma Ahorra" <${process.env.EMAIL_USER}>`,
            to: username,
            subject: 'Verifica tu cuenta',
            html: `<p>Hola ${name},</p><p>Por favor, verifica tu cuenta haciendo clic en el siguiente enlace:</p><a href="${verificationLink}">${verificationLink}</a>`
        });

        //res.render('register', { title: 'Crear Cuenta', message: 'Registro exitoso. Revisa tu correo para verificar tu cuenta.' });
        res.json({
            message: 'Registro exitoso. Revisa tu correo para verificar tu cuenta.'
        });
    } catch (error) {
        console.error('Error en registro:', error);
        res.status(401).json({
            error: 'Error al crear la cuenta'
        });
        //res.render('register', { title: 'Crear Cuenta', error: 'Error al crear la cuenta' });
    }
});

module.exports = router;