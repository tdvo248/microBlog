// showdb.js

const sqlite = require('sqlite');
const sqlite3 = require('sqlite3');

// Placeholder for the database file name
const dbFileName = 'test.db';

async function showDatabaseContents() {
    const db = await sqlite.open({ filename: dbFileName, driver: sqlite3.Database });

    console.log('Opening database file:', dbFileName);

    // Check if the users table exists
    const usersTableExists = await db.get(`SELECT name FROM sqlite_master WHERE type='table' AND name='users';`);
    if (usersTableExists) {
        console.log('Users table exists.');
        const users = await db.all('SELECT * FROM users');
        if (users.length > 0) {
            console.log('Users:');
            users.forEach(user => {
                console.log(user);
            });
        } else {
            console.log('No users found.');
        }
    } else {
        console.log('Users table does not exist.');
    }

    // Check if the posts table exists
    const postsTableExists = await db.get(`SELECT name FROM sqlite_master WHERE type='table' AND name='posts';`);
    if (postsTableExists) {
        console.log('Posts table exists.');
        const posts = await db.all('SELECT * FROM posts');
        if (posts.length > 0) {
            console.log('Posts:');
            posts.forEach(post => {
                console.log(post);
            });
        } else {
            console.log('No posts found.');
        }
    } else {
        console.log('Posts table does not exist.');
    }

    await db.close();
}

showDatabaseContents().catch(err => {
    console.error('Error showing database contents:', err);
});
