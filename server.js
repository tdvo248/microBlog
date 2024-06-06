const express = require('express');
const expressHandlebars = require('express-handlebars');
const session = require('express-session');
const fetch = require('node-fetch');
const passport = require('passport');
const GoogleStrategy = require('passport-google-oauth20').Strategy;
const { createCanvas } = require('canvas');
const sqlite = require('sqlite');
const sqlite3 = require('sqlite3');
require('dotenv').config();

// Configuration and Setup
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
            memberSince DATETIME NOT NULL,
            likedPosts TEXT DEFAULT '{}',
            followerCount INTEGER DEFAULT '0'
        );

        CREATE TABLE IF NOT EXISTS posts (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            title TEXT NOT NULL,
            content TEXT NOT NULL,
            username TEXT NOT NULL,
            timestamp DATETIME NOT NULL,
            likes INTEGER NOT NULL
        );

        CREATE TABLE IF NOT EXISTS comments (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            post_id INTEGER NOT NULL,
            username TEXT NOT NULL,
            content TEXT NOT NULL,
            timestamp DATETIME NOT NULL,
            FOREIGN KEY(post_id) REFERENCES posts(id) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS followers (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            follower TEXT NOT NULL,
            following TEXT NOT NULL,
            UNIQUE(follower, following)
        );

    `);
}

// Configure passport
passport.use(new GoogleStrategy({
    clientID: CLIENT_ID,
    clientSecret: CLIENT_SECRET,
    callbackURL: `http://localhost:${PORT}/auth/google/callback`
}, async (token, tokenSecret, profile, done) => {
    let user = await db.get('SELECT * FROM users WHERE hashedGoogleId = ?', profile.id);
    if (!user) {
        const tempUsername = `temp_${profile.id}`; // Generate a unique temporary username
        await db.run(
            'INSERT INTO users (hashedGoogleId, username, memberSince) VALUES (?, ?, ?)',
            [profile.id, tempUsername, new Date().toISOString()]
        );
        user = await db.get('SELECT * FROM users WHERE hashedGoogleId = ?', profile.id);
    }
    return done(null, user);
}));

passport.serializeUser((user, done) => {
    done(null, user.id);
});

passport.deserializeUser(async (id, done) => {
    const user = await db.get('SELECT * FROM users WHERE id = ?', id);
    done(null, user);
});

// Handlebars Helpers
app.engine(
    'handlebars',
    expressHandlebars.engine({
        helpers: {
            toLowerCase: function (str) {
                return str.toLowerCase();
            },
            ifCond: function (v1, v2, options) {
                if (options.fn && v1 === v2) {
                    return options.fn(this);
                } else if (options.fn) {
                    return options.inverse(this);
                }
                return v1 === v2;  // Return boolean if not used as a block
            },            
        },
    })
);

app.set('view engine', 'handlebars');
app.set('views', './views');

// Middleware
app.use(
    session({
        secret: 'oneringtorulethemall', // Secret key to sign the session ID cookie
        resave: false, // Don't save session if unmodified
        saveUninitialized: false, // Don't create session until something stored
        cookie: { secure: false }, // True if using https. Set to false for development without https
    })
);

app.use((req, res, next) => {
    res.locals.appName = 'FishTalk';
    res.locals.copyrightYear = 2024;
    res.locals.postNeoType = 'Post';
    res.locals.loggedIn = req.session.loggedIn || false;
    res.locals.userId = req.session.userId || '';
    next();
});

app.use(passport.initialize());
app.use(passport.session());

app.use(express.static('public')); // Serve static files
app.use(express.urlencoded({ extended: true })); // Parse URL-encoded bodies (as sent by HTML forms)
app.use(express.json()); // Parse JSON bodies (as sent by API clients)

// Routes

// Home route: render home view with posts and user
app.get('/', async (req, res) => {
    const sort = req.query.sort || 'latest';
    const user = await getCurrentUser(req) || {};
    let posts = await getPosts(user);

    if (sort === 'likes') {
        posts.sort((a, b) => b.likes - a.likes);
    } else if (sort === 'oldest') {
        posts.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
    } else {
        posts.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
    }

    res.render('home', { posts, user, sort });
});

app.get('/auth/google', passport.authenticate('google', { scope: ['profile', 'email'] }));

app.get('/auth/google/callback', passport.authenticate('google', { failureRedirect: '/loginRegister' }), async (req, res) => {
    const user = req.user;
    if (!user.username || user.username.startsWith('temp_')) {
        req.session.userId = user.id;
        res.redirect('/registerUsername');
    } else {
        req.session.userId = user.id;
        req.session.username = user.username;
        req.session.loggedIn = true;
        res.redirect('/');
    }
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

app.get('/registerUsername', isAuthenticated, (req, res) => {
    res.render('registerUsername', { title: 'Register Username' });
});

app.get('/register', (req, res) => {
    res.render('loginRegister', { regError: req.query.error });
});

app.get('/login', (req, res) => {
    res.render('loginRegister', { title: 'Login/Register' });
});

app.get('/error', (req, res) => {
    res.render('error');
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
    handleAvatar(req, res, user);
});

app.get('/logout', (req, res) => {
    req.logout((err) => {
        if (err) {
            return next(err);
        }
        req.session.destroy((err) => {
            if (err) {
                return next(err);
            }
            res.redirect('/googleLogout');
        });
    });
});

app.get('/googleLogout', (req, res) => {
    const logoutUrl = 'https://accounts.google.com/Logout';
    res.render('googleLogout', { logoutUrl });
});

app.get('/logoutCallback', (req, res) => {
    res.redirect('/');
});

app.post('/registerUsername', isAuthenticated, async (req, res) => {
    const username = req.body.username;
    const userId = req.session.userId;
    const existingUser = await db.get('SELECT * FROM users WHERE username = ?', username);
    if (existingUser) {
        res.render('registerUsername', { error: 'Username already exists', title: 'Register Username' });
    } else {
        const avatar_url = generateAvatar(username.charAt(0).toUpperCase());
        await db.run('UPDATE users SET username = ?, avatar_url = ? WHERE id = ?', [username, avatar_url, userId]);
        const user = await db.get('SELECT * FROM users WHERE id = ?', userId); // Retrieve the updated user info
        req.session.userId = user.id; // Use user.id instead of username
        req.session.username = user.username; // Ensure username is updated in the session
        req.session.loggedIn = true;
        res.redirect('/');
    }
});

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

    // Initialize likedPosts if not present
    if (!user.likedPosts) {
        user.likedPosts = {};
    }

    if (liked) {
        if (!user.likedPosts[postId]) {
            user.likedPosts[postId] = true;
            await db.run('UPDATE posts SET likes = likes + 1 WHERE id = ?', [postId]);
        }
    } else {
        if (user.likedPosts[postId]) {
            delete user.likedPosts[postId];
            await db.run('UPDATE posts SET likes = likes - 1 WHERE id = ?', [postId]);
        }
    }

    const updatedPost = await db.get('SELECT * FROM posts WHERE id = ?', [postId]);
    res.json({ success: true, likes: updatedPost.likes, liked: liked });
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

// Post Comments 
app.post('/posts/:id/comments', async (req, res) => {
    const { content } = req.body;
    const { id } = req.params;
    const user = await getCurrentUser(req);
    if (user) {
        await db.run('INSERT INTO comments (post_id, username, content, timestamp) VALUES (?, ?, ?, ?)', [
            id, user.username, content, new Date().toISOString()
        ]);
        res.redirect('/');
    } else {
        res.redirect('/login');
    }
});


// Follow a user
app.post('/follow/:username', isAuthenticated, async (req, res) => {
    const targetUsername = req.params.username;
    const currentUser = await getCurrentUser(req);

    if (currentUser.username === targetUsername) {
        return res.status(403).json({ success: false, message: 'Cannot follow yourself' });
    }

    const targetUser = await findUserByUsername(targetUsername);

    if (!targetUser) {
        return res.status(404).json({ success: false, message: 'User not found' });
    }

    // Check if already following to prevent multiple increments
    const isFollowing = await db.get('SELECT * FROM followers WHERE follower = ? AND following = ?', [currentUser.username, targetUsername]);

    if (!isFollowing) {
        await db.run('INSERT INTO followers (follower, following) VALUES (?, ?)', [currentUser.username, targetUsername]);
        await db.run('UPDATE users SET followerCount = followerCount + 1 WHERE username = ?', [targetUsername]);
        res.json({ success: true, message: 'Followed successfully' });
    } else {
        res.status(403).json({ success: false, message: 'Already following' });
    }
});

// Unfollow a user
app.post('/unfollow/:username', isAuthenticated, async (req, res) => {
    const targetUsername = req.params.username;
    const currentUser = await getCurrentUser(req);

    const isFollowing = await db.get('SELECT * FROM followers WHERE follower = ? AND following = ?', [currentUser.username, targetUsername]);

    if (isFollowing) {
        await db.run('DELETE FROM followers WHERE follower = ? AND following = ?', [currentUser.username, targetUsername]);
        await db.run('UPDATE users SET followerCount = followerCount - 1 WHERE username = ?', [targetUsername]);
        res.json({ success: true, message: 'Unfollowed successfully' });
    } else {
        res.status(403).json({ success: false, message: 'Not following' });
    }
});



// Server Activation

initializeDB().then(() => {
    app.listen(PORT, () => {
        console.log(`Server is running on http://localhost:${PORT}`);
    });
});

// Support Functions and Variables

// Function to find a user by username
async function findUserByUsername(username) {
    return await db.get('SELECT * FROM users WHERE username = ?', [username]);
}

// Function to add a new user
async function addUser(username, hashedGoogleId, avatar_url) {
    await db.run('INSERT INTO users (username, hashedGoogleId, avatar_url, memberSince, likedPosts) VALUES (?, ?, ?, ?, ?)', [
        username,
        hashedGoogleId,
        avatar_url,
        new Date().toISOString(),
        JSON.stringify({})
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
    const user = await db.get('SELECT * FROM users WHERE id = ?', [req.session.userId]); // Fetch user by ID
    if (user) {
        user.likedPosts = user.likedPosts ? JSON.parse(user.likedPosts) : {};
    }
    return user;
}

// // Function to get all posts, sorted by latest first
// async function getPosts() {
//     return await db.all('SELECT * FROM posts ORDER BY timestamp DESC');
// }

// Modify getPosts or similar function to also fetch comments
// Function to get all posts, sorted by latest first
async function getPosts(currentUser) {
    const posts = await db.all('SELECT * FROM posts ORDER BY timestamp DESC');
    for (let post of posts) {
        post.comments = await getCommentsByPostId(post.id);
        // Check if the current user is following the post's author
        if (currentUser) {
            const isFollowing = await db.get('SELECT * FROM followers WHERE follower = ? AND following = ?', [currentUser.username, post.username]);
            post.isFollowing = !!isFollowing;
        } else {
            post.isFollowing = false;
        }
    }
    return posts;
}


// Function to get comments 
async function getCommentsByPostId(postId) {
    return await db.all('SELECT * FROM comments WHERE post_id = ? ORDER BY timestamp DESC', [postId]);
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
function handleAvatar(req, res, user) {
    if (user.avatar_url) {
        // If the avatar_url exists, serve the image directly
        const avatarUrl = user.avatar_url;
        const base64Data = avatarUrl.split(',')[1];
        const imgBuffer = Buffer.from(base64Data, 'base64');
        res.writeHead(200, {
            'Content-Type': 'image/png',
            'Content-Length': imgBuffer.length
        });
        res.end(imgBuffer);
    } else {
        // If the avatar_url does not exist, generate and serve the default avatar
        const letter = user.username.charAt(0).toUpperCase();
        const avatarUrl = generateAvatar(letter);
        const base64Data = avatarUrl.split(',')[1];
        const imgBuffer = Buffer.from(base64Data, 'base64');
        res.writeHead(200, {
            'Content-Type': 'image/png',
            'Content-Length': imgBuffer.length
        });
        res.end(imgBuffer);
    }
}

// Function to generate an image avatar
function generateAvatar(letter) {
    const canvas = createCanvas(100, 100);
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
    context.fillRect(0, 0, 100, 100);

    context.fillStyle = '#000';
    context.font = 'bold 48px sans-serif';
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    context.fillText(letter, 50, 50);

    return canvas.toDataURL(); // Return base64-encoded URL
}
