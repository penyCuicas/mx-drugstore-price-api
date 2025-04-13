const express = require('express');
const session = require('express-session');
const bodyParser = require('body-parser');
const path = require('path');
const dbHandler = require('../src/db/dbHandler');
const searchHandler = require('../src/searchHandler');
const authRoutes = require('../src/routes/authRoutes');
const exphbs = require('express-handlebars');
const config = require('config');
const hoursOfFreePremiumAccount = config.get('preferences.hoursOfFreePremiumAccount');
const whatsappUrl = config.get('preferences.whatsappUrl');
require('dotenv').config()


const app = express();
const PORT = process.env.PORT || 3000;

// Configurar Handlebars
const hbs = exphbs.create({
    extname: '.hbs',
    defaultLayout: 'main',
    partialsDir: path.join(__dirname, '../views/partials/')
});

app.engine('.hbs', hbs.engine);
app.set('view engine', '.hbs');
app.set('views', path.join(__dirname, '../views'));

// Webhook to update subscription status
app.post('/webhook', express.raw({
    type: 'application/json'
}), async (req, res) => {
    const sig = req.headers['stripe-signature'];
    let event = req.body;
    const stripeConfig = config.get('preferences.stripe')
    const Stripe = require('stripe');
    const stripe = Stripe(process.env.STRIPE_SECRET_KEY);

    try {
        event = stripe.webhooks.constructEvent(req.body, sig, process.env.STRIPE_WEBHOOK_SECRET);

        if (event.type === 'customer.subscription.updated' || event.type === 'customer.subscription.created') {
            const subscription = event.data.object;
            //console.log(subscription);
            //get the related customer
            const customer = await stripe.customers.retrieve(subscription.customer);
            console.log(customer);
            if (!customer.email) {
                return res.status(400).send(`Stripe Customer without email: ${subscription.customer}`);
            }
            console.log(customer.email);
            var user = await dbHandler.getUserByLogin(customer.email);
            console.log(user);
            if (!user) {
                return res.status(400).send(`Customer does not exists in our database: ${subscription.customer_details.email}`);
            }
    
            var localSubscription = {
                userId: user.id,
                stripeSubscriptionId: subscription.id,
                status: subscription.status,
                planName: stripeConfig.plan_name,
                currentPeriodEnd: subscription.current_period_end
            };
    
            await dbHandler.createSubscription(localSubscription);
        }

    } catch (err) {
        console.log(err.message);
        return res.status(400).send(`Webhook Error: ${err.message}`);
    }

    
    res.json({
        received: true
    });
});

// Middleware to parse JSON bodies
app.use(bodyParser.json());
app.use(express.urlencoded({
    extended: true
}));

app.use(session({
    secret: process.env.SESSION_SECRET || 'mi_secreto_super_seguro',
    resave: false,
    saveUninitialized: false,
    cookie: {
        secure: false,
        maxAge: 24 * 60 * 60 * 1000
    }
}));

// In Express
app.use((req, res, next) => {
    res.set('Cache-Control', 'no-store, no-cache, must-revalidate, private');
    next();
});

// Middleware para pasar el estado de la sesión a todas las vistas
app.use((req, res, next) => {
    res.locals.user = req.session.user || null;
    res.locals.loggedIn = !!req.session.user;
    next();
});



// Serve static files from the "public" directory
app.use(express.static(path.join(__dirname, '../public')));
app.use('/bootstrap', express.static(path.join(__dirname, '../node_modules/bootstrap/dist')));
app.use('/auth', authRoutes);

app.get('/', (req, res) => {
    res.render('index', {
        title: 'Bienvenido',
        whatsappUrl: whatsappUrl
    });
});

app.get('/login', (req, res) => {
    res.render('login', {
        title: 'Iniciar Sesión'
    });
});


app.get('/register', (req, res) => {
    res.render('register', {
        title: 'Crear Cuenta'
    });
});

// Account route
app.get('/account', async (req, res) => {
    if (!res.locals.loggedIn) {
        res.redirect('/login');
        return;
    }

    var rows = await dbHandler.getSubscriptions(res.locals.user.id);
    var subscription = null;
    if (rows.length > 0) {
        console.log(rows[0]);
        subscription = {
            status: rows[0].status,
            planName: rows[0].planName,
            currentPeriodEnd: new Date(rows[0].currentPeriodEnd).toLocaleDateString('es-MX'),
            isExpired: rows[0].status === 'expired',
            isCanceled: rows[0].status === 'canceled'
        };
    }

    res.render('account', {
        subscription: subscription
    });

});

// Stripe checkout for renewal/subscription
app.post('/create-checkout-session', async (req, res) => {
    if (!res.locals.loggedIn) {
        res.redirect('/login');
        return;
    }
    try {
        const stripeConfig = config.get('preferences.stripe')
        const Stripe = require('stripe');
        const stripe = Stripe(process.env.STRIPE_SECRET_KEY);
        const session = await stripe.checkout.sessions.create({
            mode: 'subscription',
            payment_method_types: ['card'],
            line_items: [{
                price: stripeConfig.price_id, // Create in Stripe dashboard
                quantity: 1
            }],
            success_url: stripeConfig.success_url,
            cancel_url: stripeConfig.cancel_url,
            customer_email: req.session.user.email
        });
        res.json({
            url: session.url
        });
    } catch (error) {
        res.status(500).json({
            error: error.message
        });
    }
});



app.get('/verify/:token', async (req, res) => {
    const {
        token
    } = req.params;
    const verified = await dbHandler.verifyUser(token);
    if (verified) {
        res.redirect('/login');
        //res.render('login', { title: 'Iniciar Sesión', message: 'Cuenta verificada. Por favor, inicia sesión.' });
    } else {
        res.redirect('/');
        //res.render('register', { title: 'Bienvenido', error: 'Token inválido o cuenta ya verificada.' });
    }
});

// Protected route example
app.post('/search', async (req, res) => {
    const googleUrl = 'https://www.google.com/search?q=';
    const queryText = req.body.query;
    var isLoggedIn = false;
    var isPremium = false;
    if (req.session && req.session.user && req.session.user.email) {
        isLoggedIn = true;
        isPremium = await searchHandler.checkIsPremiumUser(req.session.user.email);
    }

    if (!queryText) {
        return res.sendStatus(400).json({
            error: 'Query text is required'
        });
    }

    if (queryText.length < 5) {
        return res.sendStatus(400).json({
            error: 'Query text must be at least 5 characters'
        });
    }

    var result = await searchHandler.execute(queryText);

    //limit results
    result.sites.forEach(site => {
        site.products = site.products.slice(0, 5);
    });

    result.alertNotLoggedIn = 'Registrate y obten ' + hoursOfFreePremiumAccount + ' horas para probar nuestro servicio';
    result.alertSubscriptionExpired = 'Suscríbete para seguir usando el servicio'
    result.isLoggedIn = isLoggedIn;
    result.isPremium = isPremium;

    result.sites.forEach(site => {
        if (site.urlFromGoogle) {
            site.drugStoreNameUrl = [googleUrl, site.drugStoreName].join('');
        }

        if (!isPremium) {
            site.drugStoreName = 'Farmacia ???????';
            site.drugStoreNameUrl = '';
        }

        site.products.forEach(product => {
            if (site.urlFromGoogle) {
                product.path = [site.drugStoreNameUrl, product.name].join('+');
            } else {
                product.path = [site.drugStoreNameUrl, product.path].join('');
            }

            if (!isPremium) {
                product.price = 9.99;
                product.listPrice = 10.00;
                product.path = '';
                product.promotionInfo = '';
            }
        });
    });


    res.json(result);
});


app.listen(PORT, () => {
    console.log(`Server is running on http://localhost:${PORT}`);
});