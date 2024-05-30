const express = require('express');
const expressHandlebars = require('express-handlebars');
const session = require('express-session');
const fetch = require('node-fetch');
const passport = require('passport');
const GoogleStrategy = require('passport-google-oauth20').Strategy;
const { createCanvas, loadImage } = require('canvas');
const sqlite = require('sqlite');
const sqlite3 = require('sqlite3');
require('dotenv').config();


//~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
// Configuration and Setup
//~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~

const app = express();
const PORT = 3000;
const EMOJI_API_KEY = process.env.EMOJI_API_KEY;
const dbFileName = process.env.DATABASE_NAME;

let db;

// Use environment variables for client ID and secret
const CLIENT_ID = process.env.CLIENT_ID;
const CLIENT_SECRET = process.env.CLIENT_SECRET;


async function initializeDB() {
    db = await sqlite.open({ filename: dbFileName, driver: sqlite3.Database });
    await db.exec(`
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT NOT NULL UNIQUE,
            hashedGoogleId TEXT NOT NULL UNIQUE,
            avatar_url TEXT,
            memberSince DATETIME NOT NULL
        );

        CREATE TABLE IF NOT EXISTS posts (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            title TEXT NOT NULL,
            content TEXT NOT NULL,
            username TEXT NOT NULL,
            timestamp DATETIME NOT NULL,
            likes INTEGER NOT NULL
        );
    `);
}

// Configure passport
passport.use(new GoogleStrategy({
    clientID: CLIENT_ID,
    clientSecret: CLIENT_SECRET,
    callbackURL: `http://localhost:${PORT}/auth/google/callback`
}, (token, tokenSecret, profile, done) => {
    return done(null, profile);
}));

passport.serializeUser((user, done) => {
    done(null, user);
});

passport.deserializeUser((obj, done) => {
    done(null, obj);
});

/*
~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
    Handlebars Helpers

    Handlebars helpers are custom functions that can be used within the templates 
    to perform specific tasks. They enhance the functionality of templates and 
    help simplify data manipulation directly within the view files.

    In this project, two helpers are provided:
    
    1. toLowerCase:
       - Converts a given string to lowercase.
       - Usage example: {{toLowerCase 'SAMPLE STRING'}} -> 'sample string'

    2. ifCond:
       - Compares two values for equality and returns a block of content based on 
         the comparison result.
       - Usage example: 
            {{#ifCond value1 value2}}
                <!-- Content if value1 equals value2 -->
            {{else}}
                <!-- Content if value1 does not equal value2 -->
            {{/ifCond}}
~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
*/

// Set up Handlebars view engine with custom helpers
//
app.engine(
    'handlebars',
    expressHandlebars.engine({
        helpers: {
            toLowerCase: function (str) {
                return str.toLowerCase();
            },
            ifCond: function (v1, v2, options) {
                if (v1 === v2) {
                    return options.fn(this);
                }
                return options.inverse(this);
            },
        },
    })
);

app.set('view engine', 'handlebars');
app.set('views', './views');

//~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
// Middleware
//~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~

app.use(
    session({
        secret: 'oneringtorulethemall',     // Secret key to sign the session ID cookie
        resave: false,                      // Don't save session if unmodified
        saveUninitialized: false,           // Don't create session until something stored
        cookie: { secure: false },          // True if using https. Set to false for development without https
    })
);

// Replace any of these variables below with constants for your application. These variables
// should be used in your template files. 
// 
app.use((req, res, next) => {
    res.locals.appName = 'FishTalk';
    res.locals.copyrightYear = 2024;
    res.locals.postNeoType = 'Post';
    res.locals.loggedIn = req.session.loggedIn || false;
    res.locals.userId = req.session.userId || '';
    next();
});

app.use(express.static('public'));                  // Serve static files
app.use(express.urlencoded({ extended: true }));    // Parse URL-encoded bodies (as sent by HTML forms)
app.use(express.json());                            // Parse JSON bodies (as sent by API clients)

//~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
// Routes
//~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~

// Home route: render home view with posts and user
// We pass the posts and user variables into the home
// template
//
app.get('/', async (req, res) => {
    const sort = req.query.sort || 'latest';
    let posts = await getPosts();

    if (sort === 'likes') {
        posts.sort((a, b) => b.likes - a.likes);
    } else if (sort === 'oldest') {
        posts.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
    } else {
        posts.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
    }

    const user = await getCurrentUser(req) || {};
    res.render('home', { posts, user, sort });
});


app.get('/api/emojis', async (req, res) => {
    try {
        const response = await fetch(`https://emoji-api.com/emojis?access_key=${EMOJI_API_KEY}`);
        const data = await response.json();
        res.json(data);
    } catch (error) {
        res.status(500).json({ error: 'Failed to fetch emojis' });
    }
});

//registerUsername path
app.get('/registerUsername', (req, res)=>{
    res.render('registerUsername',{
        title: 'Register Username'
    });
});

app.post('/registerUsername', async(req, res)=>{
    const username = req.body.username;
    const userId =req.user.id;

    const exitingUser = await db.get('SELECT * FROM users WHERE selectedUsername = ?', username);
    if(exitstingUser){
        res.session.error = "Username already exist";
        return res.redirect('/registerUsername');
    }

    await db.run('UPDATE users SET selectedUsername = ? WHERE id = ?', [username, userId]);

    req.user.selectUsername = username;

    res.redirect('/');
})


// Register GET route is used for error response from registration
//
app.get('/register', (req, res) => {
    res.render('loginRegister', { regError: req.query.error });
});

// Login route GET route is used for error response from login
//
app.get('/login', (req, res) => {
    res.render('loginRegister', { loginError: req.query.error });
});

// Error route: render error page
//
app.get('/error', (req, res) => {
    res.render('error');
});

// Additional routes that you must implement


// app.get('/post/:id', (req, res) => {
//     // TODO: Render post detail page
// });
app.post('/posts', async (req, res) => {
    const { title, content } = req.body;
    const user = await getCurrentUser(req);
    if (user) {
        await addPost(title, content, user);
        res.redirect('/');
    } else {
        res.redirect('/login');
    }
});

app.post('/like/:id', async (req, res) => {
    const postId = parseInt(req.params.id);
    const user = await getCurrentUser(req);

    if (!user) {
        return res.status(401).json({ success: false, message: 'Not authenticated' });
    }

    const post = await db.get('SELECT * FROM posts WHERE id = ?', [postId]);

    if (!post) {
        return res.status(404).json({ success: false, message: 'Post not found' });
    }

    if (post.username === user.username) {
        return res.status(403).json({ success: false, message: 'Cannot like your own post' });
    }

    const liked = req.body.liked;

    if (liked) {
        if (!user.likedPosts) {
            user.likedPosts = {};
        }
        if (!user.likedPosts[postId]) {
            user.likedPosts[postId] = true;
            await db.run('UPDATE posts SET likes = likes + 1 WHERE id = ?', [postId]);
        }
    } else {
        if (user.likedPosts && user.likedPosts[postId]) {
            delete user.likedPosts[postId];
            await db.run('UPDATE posts SET likes = likes - 1 WHERE id = ?', [postId]);
        }
    }

    const updatedPost = await db.get('SELECT * FROM posts WHERE id = ?', [postId]);
    res.json({ success: true, likes: updatedPost.likes, liked: liked });
});

app.get('/profile', isAuthenticated, async (req, res) => {
    const user = await getCurrentUser(req);
    if (user) {
        const sort = req.query.sort || 'latest';
        user.posts = await getPostsByUser(user.username, sort);
        res.render('profile', { user, sort, postNeoType: 'Post' });
    } else {
        res.redirect('/login');
    }
});

app.get('/avatar/:username', async (req, res) => {
    const user = await findUserByUsername(req.params.username);
    if (!user) {
        res.status(404).send('Avatar not found');
        return;
    }
    handleAvatar(req, res);
});

app.post('/register', async (req, res) => {
    //Remove the hashedGoogleID = 0 when implementing google oauth
    const { username, hashedGoogleId=0, avatar_url } = req.body;
    if (await findUserByUsername(username)) {
        return res.redirect('/register?error=Username already taken');
    }
    await addUser(username, hashedGoogleId, avatar_url);
    req.session.userId = username;
    req.session.loggedIn = true;
    res.redirect('/');
});

app.post('/login', async (req, res) => {
    const { username } = req.body;
    const user = await findUserByUsername(username);
    if (!user) {
        return res.redirect('/login?error=Username not recognized');
    }
    req.session.userId = username;
    req.session.loggedIn = true;
    res.redirect('/');
});

app.get('/logout', (req, res) => {
    req.logout((err) => {
        if (err) {
            return next(err);
        }
        res.redirect('/googleLogout');
    });
});

app.get('/googleLogout', (req, res) => {
    res.render('googleLogout');
});

app.get('/logoutCallback', (req, res)=>{
    res.redirect('/');
});

app.post('/delete/:id', isAuthenticated, async (req, res) => {
    const postId = parseInt(req.params.id);
    const user = await getCurrentUser(req);

    if (!user) {
        return res.status(401).json({ success: false, message: 'Not authenticated' });
    }

    const post = await db.get('SELECT * FROM posts WHERE id = ?', [postId]);

    if (!post) {
        return res.status(404).json({ success: false, message: 'Post not found' });
    }

    if (post.username !== user.username) {
        return res.status(403).json({ success: false, message: 'Cannot delete posts that are not yours' });
    }

    await db.run('DELETE FROM posts WHERE id = ?', [postId]);
    res.json({ success: true, message: 'Post deleted' });
});


//~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
// Server Activation
//~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~

initializeDB().then(() => {
    app.listen(PORT, () => {
        console.log(`Server is running on http://localhost:${PORT}`);
    });
});

//~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
// Support Functions and Variables
//~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~

// Function to find a user by username
async function findUserByUsername(username) {
    return await db.get('SELECT * FROM users WHERE username = ?', [username]);
}

// Function to add a new user
async function addUser(username, hashedGoogleId, avatar_url) {
    await db.run('INSERT INTO users (username, hashedGoogleId, avatar_url, memberSince) VALUES (?, ?, ?, ?)', [
        username,
        ++hashedGoogleId,
        avatar_url,
        new Date().toISOString()
    ]);
}


// Middleware to check if user is authenticated
function isAuthenticated(req, res, next) {
    if (req.session.userId) {
        next();
    } else {
        res.redirect('/login');
    }
}

// Function to get the current user from session
async function getCurrentUser(req) {
    if (!req.session.userId) return null;
    const user = await findUserByUsername(req.session.userId);
    if (user && !user.likedPosts) {
        user.likedPosts = {}; // Ensure likedPosts is initialized
    } else {
        user.likedPosts = JSON.parse(user.likedPosts);
    }
    return user;
}


// Function to get all posts, sorted by latest first
async function getPosts() {
    return await db.all('SELECT * FROM posts ORDER BY timestamp DESC');
}

// Function to get posts by a specific user
async function getPostsByUser(username, sort = 'latest') {
    let userPosts = await db.all('SELECT * FROM posts WHERE username = ?', [username]);

    if (sort === 'likes') {
        userPosts.sort((a, b) => b.likes - a.likes);
    } else if (sort === 'oldest') {
        userPosts.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
    } else {
        userPosts.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
    }

    return userPosts;
}


// Function to add a new post
async function addPost(title, content, user) {
    await db.run('INSERT INTO posts (title, content, username, timestamp, likes) VALUES (?, ?, ?, ?, ?)', [
        title,
        content,
        user.username,
        new Date().toISOString(),
        0
    ]);
}


// Function to handle avatar generation and serving
function handleAvatar(req, res) {
    const letter = req.params.username.charAt(0).toUpperCase();
    generateAvatar(letter, req, res);
}


// Function to generate an image avatar
async function generateAvatar(letter, req, res, width = 100, height = 100) {
    const canvas = createCanvas(width, height);
    const context = canvas.getContext('2d');

    const colors = [
        '#FF5733', '#33FF57', '#3357FF', '#FF33A6',
        '#F1C40F', '#1ABC9C', '#8E44AD', '#E74C3C',
        '#2ECC71', '#3498DB', '#9B59B6', '#E67E22',
        '#F39C12', '#D35400', '#2980B9', '#C0392B',
        '#27AE60', '#16A085', '#34495E', '#7F8C8D'
    ];
    const bgColor = colors[letter.charCodeAt(0) % colors.length];

    context.fillStyle = bgColor;
    context.fillRect(0, 0, width, height);

    context.fillStyle = '#000';
    context.font = 'bold 48px sans-serif';
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    context.fillText(letter, width / 2, height / 2);

    res.setHeader('Content-Type', 'image/png');
    res.send(canvas.toBuffer('image/png'));
}