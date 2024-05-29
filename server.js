const express = require('express');
const expressHandlebars = require('express-handlebars');
const session = require('express-session');
const fetch = require('node-fetch');
const { createCanvas, loadImage } = require('canvas');
require('dotenv').config();


//~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
// Configuration and Setup
//~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~

const app = express();
const PORT = 3000;
const EMOJI_API_KEY = process.env.EMOJI_API_KEY;;

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
app.get('/', (req, res) => {
    const posts = getPosts();
    const user = getCurrentUser(req) || {};
    res.render('home', { posts, user });
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
app.post('/posts', (req, res) => {
    // TODO: Add a new post and redirect to home
    const { title, content } = req.body;
    const user = getCurrentUser(req);
    if (user) {
        addPost(title, content, user);
        res.redirect('/');
    } else {
        res.redirect('/login');
    }
});
app.post('/like/:id', (req, res) => {
    const postId = parseInt(req.params.id);
    const user = getCurrentUser(req);

    if (!user) {
        return res.status(401).json({ success: false, message: 'Not authenticated' });
    }

    const post = posts.find(post => post.id === postId);

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
            post.likes += 1;
        }
    } else {
        if (user.likedPosts && user.likedPosts[postId]) {
            delete user.likedPosts[postId];
            post.likes -= 1;
        }
    }

    res.json({ success: true, likes: post.likes, liked: liked });
});

app.get('/profile', isAuthenticated, (req, res) => {
    // TODO: Render profile page
    const user = getCurrentUser(req);
    if (user) {
        const userPosts = getPostsByUser(user.username);
        res.render('profile', { user: { ...user, posts: userPosts } });
    } else {
        res.redirect('/login');
    }
});
app.get('/avatar/:username', (req, res) => {
    // TODO: Serve the avatar image for the user
    const user = findUserByUsername(req.params.username);
    if (!user) {
        res.status(404).send('Avatar not found');
        res.redirect('/');
    }

    console.log(req.params);

    handleAvatar(req, res);


});
app.post('/register', (req, res) => {
    // TODO: Register a new user
    const { username } = req.body;
    if (findUserByUsername(username)) {
        return res.redirect('/register?error=Username already taken');
    }
    // const avatarFilename = handleAvatar(username.charAt(0), users.length + 1);
    addUser(username);
    req.session.userId = username;
    req.session.loggedIn = true;
    // console.log(`Register - ${req.session.userId}`);
    res.redirect('/');
});
app.post('/login', (req, res) => {
    // TODO: Login a user
    const { username } = req.body;
    const user = findUserByUsername(username);
    if (!user) {
        return res.redirect('/login?error=Username not recognized');
    }
    req.session.userId = username;
    req.session.loggedIn = true;
    // console.log(`Login - ${req.session.userId}`);
    
    res.redirect('/');
});
app.get('/logout', (req, res) => {
    // TODO: Logout the user
    req.session.destroy(err => {
        if (err) {
            return res.redirect('/error');
        }
        res.redirect('/');
    });
});
app.post('/delete/:id', isAuthenticated, (req, res) => {
    const postId = parseInt(req.params.id);
    const user = getCurrentUser(req);

    if (!user) {
        return res.status(401).json({ success: false, message: 'Not authenticated' });
    }

    const postIndex = posts.findIndex(post => post.id === postId);

    if (postIndex === -1) {
        return res.status(404).json({ success: false, message: 'Post not found' });
    }

    const post = posts[postIndex];

    if (post.username !== user.username) {
        return res.status(403).json({ success: false, message: 'Cannot delete posts that are not yours' });
    }

    posts.splice(postIndex, 1);

    res.json({ success: true, message: 'Post deleted' });
});


//~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
// Server Activation
//~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~

app.listen(PORT, () => {
    console.log(`Server is running on http://localhost:${PORT}`);
});

//~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
// Support Functions and Variables
//~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~

// Example data for posts and users
let posts = [];
let users = [];

// Function to find a user by username
function findUserByUsername(username) {
    // TODO: Return user object if found, otherwise return undefined
    return users.find(user => user.username === username);
}

// Function to find a user by user ID
function findUserById(userId) {
    // TODO: Return user object if found, otherwise return undefined
    return users.find(user => user.id === userId);
}

// Function to add a new user
function addUser(username) {
    // TODO: Create a new user object and add to users array
    const newUser = {
        id: users.length + 1,
        username,
        memberSince: new Date().toISOString(),
        likedPosts: {}  // Initialize likedPosts as an empty object
    };
    users.push(newUser);
}


// Middleware to check if user is authenticated
function isAuthenticated(req, res, next) {
    if (req.session.userId) {
        next();
    } else {
        res.redirect('/login');
    }
}

// Function to handle avatar generation and serving
function handleAvatar(req, res) {
    // TODO: Generate and serve the user's avatar image
    const letter = req.params.username.charAt(0).toUpperCase();
    generateAvatar(letter, req, res);
}

// Function to get the current user from session
function getCurrentUser(req) {
    const user = findUserByUsername(req.session.userId);
    if (user && !user.likedPosts) {
        user.likedPosts = {}; // Ensure likedPosts is initialized
    }
    return user;
}


// Function to get all posts, sorted by latest first
function getPosts() {
    return posts.slice().reverse();
}

// Function to get posts by a specific user
function getPostsByUser(username) {
    return posts.filter(post => post.username === username);
}

// Function to add a new post
function addPost(title, content, user) {
    // TODO: Create a new post object and add to posts array
    const newPost = {
        id: posts.length + 1,
        title,
        content,
        username: user.username,
        timestamp: new Date().toISOString(),
        likes: 0,
    };
    posts.push(newPost);
}

// Function to generate an image avatar
async function generateAvatar(letter, req, res, width = 100, height = 100) {
    // TODO: Generate an avatar image with a letter
    // Steps:
    // 1. Choose a color scheme based on the letter
    // 2. Create a canvas with the specified width and height
    // 3. Draw the background color
    // 4. Draw the letter in the center
    // 5. Return the avatar as a PNG buffer

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

    // Draw background
    context.fillStyle = bgColor;
    context.fillRect(0, 0, width, height);

    // Draw letter
    context.fillStyle = '#000';
    context.font = 'bold 48px sans-serif';
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    context.fillText(letter, width / 2, height / 2);

    // Send image buffer
    res.setHeader('Content-Type', 'image/png');
    res.send(canvas.toBuffer('image/png'));

}