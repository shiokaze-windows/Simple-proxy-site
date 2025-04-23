const express = require('express');
const axios = require('axios');
const cheerio = require('cheerio'); 
const cookieParser = require('cookie-parser');
const session = require('express-session');
const { exec } = require('child_process'); // yt-dlp用
const fs = require('fs');
const path = require('path');
const crypto = require('crypto'); 
const { promisify } = require('util'); 
const { unlink } = require('fs').promises; 
const ffmpeg = require('fluent-ffmpeg'); 

const app = express();
const port = 3000;

// 認証用の設定
const SECRET_PASSWORD = 'パスワード'; // ここに実際のパスワードを設定してください ★★★重要★★★
const SESSION_SECRET = '秘密鍵'; // セッション用の秘密鍵

// downloads ディレクトリが存在しない場合は作成
const downloadsDir = path.join(__dirname, 'downloads');
if (!fs.existsSync(downloadsDir)){
    fs.mkdirSync(downloadsDir);
}

// ミドルウェアの設定
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());
app.use(session({
    secret: SESSION_SECRET, // セッションの秘密鍵
    resave: false,
    saveUninitialized: true,
    // セッションの有効期限を1時間に設定 (ミリ秒単位)
    cookie: { maxAge: 60 * 60 * 1000, secure: false } // HTTPSを使用しない場合はfalse
}));

// exec を Promise 化して async/await で扱いやすくする
const execPromise = promisify(exec);

// ランダムなファイル名を生成
function generateRandomFileName() {
    return crypto.randomBytes(16).toString('hex');
}

/**
 * 指定された動画ファイルを一定時間後に削除
 * @param {string} filePath - 削除する動画ファイルの絶対パス
 * @param {number} delayMilliseconds - 削除を実行するまでの遅延時間（ミリ秒）
 */
async function deleteVideoAfterDelay(filePath, delayMilliseconds) {
    console.log(`動画ファイル ${filePath} を ${delayMilliseconds / 1000} 秒後に削除するようスケジュールしました。`);
    setTimeout(async () => {
        try {
            await unlink(filePath); // ファイルを非同期で削除
            console.log(`動画ファイルが削除されました: ${filePath}`);
        } catch (error) {
            if (error.code === 'ENOENT') {
                console.warn(`削除しようとした動画ファイルは既に存在しませんでした: ${filePath}`);
            } else {
                console.error(`動画ファイルの削除中にエラーが発生しました: ${filePath}`, error);
            }
        }
    }, delayMilliseconds);
}

/**
 * yt-dlpを使用してYouTube動画をWebM形式でダウンロード
 * @param {string} youtubeUrl - ダウンロードするYouTube動画のURL
 * @returns {Promise<string>} ダウンロードされた動画ファイルの絶対パス
 */
function downloadVideo(youtubeUrl) {
    return new Promise((resolve, reject) => {
        // ファイル拡張子を .webm に変更
        const fileName = generateRandomFileName() + '.webm';
        const outputPath = path.join(downloadsDir, fileName); // 保存先を指定

        // yt-dlpでWebM形式に変換しながらダウンロード
        // -f bestvideo[ext=webm]+bestaudio[ext=webm]/bestvideo+bestaudio --merge-output-format webm: 最高画質・音質を取得し、WebMにマージ
        const command = `yt-dlp -f bestvideo[ext=webm]+bestaudio[ext=webm]/bestvideo+bestaudio --merge-output-format webm --output "${outputPath}" "${youtubeUrl}"`;
        console.log(`Executing yt-dlp command: ${command}`); // 実行コマンドをログ出力

        exec(command, (error, stdout, stderr) => {
            if (error) {
                console.error(`yt-dlpエラー: ${stderr}`);
                reject(`yt-dlpの実行中にエラーが発生しました: ${stderr}`);
            } else {
                console.log(`yt-dlp標準出力:\n${stdout}`);
                // ダウンロードが成功したか確認するために、ファイルが存在するかチェック
                if (fs.existsSync(outputPath)) {
                     console.log(`動画が正常にダウンロードされました (WebM): ${outputPath}`);

                     // ダウンロード完了後、自動削除をスケジュール (例: 1時間後)
                     const oneHourInMillis = 60 * 60 * 1000;
                     deleteVideoAfterDelay(outputPath, oneHourInMillis);

                     resolve(outputPath); // 動画の保存パスを返す
                } else {
                     console.error(`yt-dlpはエラーを報告しませんでしたが、出力ファイルが見つかりません: ${outputPath}`);
                     reject(`yt-dlpは成功しましたが、出力ファイルが見つかりません。`);
                }
            }
        });
    });
}

/**
 * 動画ファイルの長さを取得
 * @param {string} filePath - 動画ファイルの絶対パス
 * @returns {Promise<number>} 動画の長さ（秒単位）
 */
function getVideoDuration(filePath) {
    return new Promise((resolve, reject) => {
        // ffmpeg.ffprobeを使用して動画のメタデータを解析
        ffmpeg.ffprobe(filePath, (err, metadata) => {
            if (err) {
                console.error(`動画の長さ取得エラー (ffprobe): ${err.message}`);
                return reject(`動画の長さ取得エラー: ${err.message}`);
            }
            // メタデータから動画の長さを取得 (秒単位)
            const durationInSeconds = metadata.format.duration;
            if (durationInSeconds) {
                 resolve(durationInSeconds);
            } else {
                 console.warn(`動画の長さがメタデータから取得できませんでした: ${filePath}`);
                 resolve(0);
            }
        });
    });
}

/**
 * ウェブサイトのコンテンツを取得
 * @param {string} url - 取得するウェブサイトのURL。
 * @returns {Promise<string>} ウェブサイトのHTMLコンテンツ。
 */
async function fetchWebPage(url) {
    try {
        const response = await axios.get(url);
        return response.data;
    } catch (error) {
        console.error(`ページ取得エラー: ${error.message}`);
        throw new Error(`ページ取得エラー: ${error.message}`);
    }
}

function isAuthenticated(req, res, next) {
    if (req.session && req.session.authenticated) {
        return next();
    } else {
        // 認証されていなければログインページへリダイレクト
        res.redirect('/login');
    }
}

// ログインページの表示
app.get('/login', (req, res) => {
    res.send(`
        <!DOCTYPE html>
        <html>
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>ログイン</title>
            <style>
                body { font-family: sans-serif; margin: 40px; background-color: #f4f4f4; color: #333; display: flex; justify-content: center; align-items: center; min-height: 80vh; }
                .container { background-color: #fff; padding: 30px; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.1); text-align: center; }
                h1 { color: #0056b3; margin-bottom: 20px; }
                form { display: flex; flex-direction: column; gap: 15px; }
                input[type="password"] { padding: 10px; border: 1px solid #ccc; border-radius: 4px; font-size: 1rem; }
                button { padding: 10px 20px; background-color: #007bff; color: white; border: none; border-radius: 4px; cursor: pointer; font-size: 1rem; transition: background-color 0.3s ease; }
                button:hover { background-color: #0056b3; }
                .error { color: red; margin-top: 15px; }
            </style>
        </head>
        <body>
            <div class="container">
                <h1>プロキシサイト ログイン</h1>
                <form action="/login" method="post">
                    <input type="password" name="password" placeholder="パスワードを入力" required>
                    <button type="submit">ログイン</button>
                </form>
                ${req.query.error ? `<p class="error">${req.query.error}</p>` : ''} </div>
        </body>
        </html>
    `);
});

// ログイン処理
app.post('/login', (req, res) => {
    const password = req.body.password;

    // パスワードの検証
    if (password === SECRET_PASSWORD) {
        // パスワードが正しければセッションに認証済みフラグを設定
        req.session.authenticated = true;
        // ログイン成功後、プロキシサイトのトップページにリダイレクト
        res.redirect('/');
    } else {
        // パスワードが間違っている場合、エラーメッセージを付けてログインページに戻る
        res.redirect('/login?error=' + encodeURIComponent('パスワードが間違っています。'));
    }
});

// ログアウト処理
app.get('/logout', (req, res) => {
    req.session.destroy((err) => {
        if (err) {
            console.error("セッション破棄エラー:", err);
            res.status(500).send("ログアウトに失敗しました。");
        } else {
            res.redirect('/login'); 
        }
    });
});


app.get('/', isAuthenticated, (req, res) => {
    res.send(`
        <!DOCTYPE html>
        <html>
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>プロキシサイト</title>
            <style>
                body { font-family: sans-serif; margin: 40px; background-color: #f4f4f4; color: #333; }
                .container { max-width: 800px; margin: 0 auto; background-color: #fff; padding: 20px; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.1); }
                h1 { color: #0056b3; }
                form { display: flex; gap: 10px; margin-bottom: 20px; }
                input[type="text"] { flex-grow: 1; padding: 10px; border: 1px solid #ccc; border-radius: 4px; font-size: 1rem; }
                button { padding: 10px 20px; background-color: #007bff; color: white; border: none; border-radius: 4px; cursor: pointer; font-size: 1rem; transition: background-color 0.3s ease; }
                button:hover { background-color: #0056b3; }
                p { color: #666; font-size: 0.9rem; }
                .error { color: red; margin-top: 10px; }
                 .logout-link { display: block; text-align: right; margin-bottom: 20px; } 
            </style>
        </head>
        <body>
            <div class="container">
                 <a href="/logout" class="logout-link">ログアウト</a> <h1>プロキシ経由でコンテンツにアクセス</h1>
                <form action="/proxy" method="post">
                    <input type="text" name="url" placeholder="URLを入力 (例: https://www.youtube.com/watch?v=...)" required>
                    <button type="submit">アクセス</button>
                </form>
                <p>注意: 動画のストリーミングには少し時間がかかる場合があります。</p>
                 ${req.query.error ? `<p class="error">${req.query.error}</p>` : ''} </div>
        </body>
        </html>
    `);
});

app.post('/proxy', isAuthenticated, async (req, res) => {
    const targetUrl = req.body.url;

    if (!targetUrl) {
        console.error("URLが指定されていません");
        return res.redirect('/?error=' + encodeURIComponent('URLを指定してください。'));
    }

    try {
        // YouTubeのURLかどうかを判定
        const youtubeRegex = /^(https?:\/\/)?(www\.)?(youtube\.com|youtu\.be)\/.+$/;

        if (youtubeRegex.test(targetUrl)) {
            console.log(`YouTube動画のURLが指定されました: ${targetUrl}`);
            // yt-dlpを使って動画をWebM形式で保存
            const videoPath = await downloadVideo(targetUrl);

            // 動画の長さを取得 
            // const durationInSeconds = await getVideoDuration(videoPath);
            // console.log(`動画の長さ: ${durationInSeconds}秒`);

            // 動画のURLをファイル名に基づいて生成
            const videoFileName = path.basename(videoPath);
            // サーバーのドメインとポートに合わせて動的にURLを生成
            const videoUrl = `${req.protocol}://${req.get('host')}/video/${videoFileName}`;
            console.log(`ストリーミングURL: ${videoUrl}`);

            // HTML5の動画タグでストリーミングURLを埋め込む
            res.send(`
                <!DOCTYPE html>
                <html>
                <head>
                    <meta charset="UTF-8">
                    <meta name="viewport" content="width=device-width, initial-scale=1.0">
                    <title>動画再生</title>
                    <style>
                        body { font-family: sans-serif; margin: 0; background-color: #f4f4f4; display: flex; justify-content: center; align-items: center; min-height: 100vh; }
                        .video-container { max-width: 90%; width: 800px; background-color: #fff; padding: 20px; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.1); }
                        video { display: block; width: 100%; height: auto; border-radius: 4px; }
                         h1 { text-align: center; color: #0056b3; margin-bottom: 20px; }
                         .logout-link { display: block; text-align: right; margin-bottom: 20px; } /* ログアウトリンクのスタイル */
                    </style>
                </head>
                <body>
                     <a href="/logout" class="logout-link">ログアウト</a> <div class="video-container">
                         <h1>動画再生</h1>
                        <video controls>
                            <source src="${videoUrl}" type="video/webm"> あなたのブラウザは動画をサポートしていません。
                        </video>
                    </div>
                </body>
                </html>
            `);
        } else {
            console.log(`一般的なURLにアクセスします: ${targetUrl}`);
            const pageContent = await fetchWebPage(targetUrl);
            res.send(pageContent);
        }
    } catch (error) {
        console.error(`処理中にエラーが発生しました: ${error.message}`);
        res.redirect('/?error=' + encodeURIComponent(`処理に失敗しました: ${error.message}`));
    }
});

// 動画ファイルのストリーミング
app.get('/video/:fileName', isAuthenticated, (req, res) => {
    const fileName = req.params.fileName;
    const filePath = path.join(downloadsDir, fileName); // ダウンロードディレクトリからのパス

    // ファイルが存在するか確認
    fs.stat(filePath, (err, stat) => {
        if (err) {
            console.error(`動画ファイルが見つからないか、アクセスできません: ${filePath}`, err);
            res.status(404).send("動画ファイルが見つかりません");
            return;
        }

        const fileSize = stat.size;
        const range = req.headers.range; 

        if (range) {
            const parts = range.replace(/bytes=/, "").split("-");
            const start = parseInt(parts[0], 10);
            const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
            const chunksize = (end - start) + 1;

            const fileStream = fs.createReadStream(filePath, { start, end });

            res.writeHead(206, { 
                "Content-Range": `bytes ${start}-${end}/${fileSize}`,
                "Accept-Ranges": "bytes",
                "Content-Length": chunksize,
                "Content-Type": "video/webm" /
            });

            fileStream.pipe(res);

            fileStream.on('error', (streamErr) => {
                console.error(`ファイルストリームエラー: ${streamErr.message}`);
                res.sendStatus(500);
            });

        } else {
            const head = {
                "Content-Length": fileSize,
                "Content-Type": "video/webm", 
            };
            res.writeHead(200, head); 
            fs.createReadStream(filePath).pipe(res);
        }
    });
});

app.listen(port, () => {
    console.log(`Proxy server running at http://localhost:${port}/`);
    console.log(`Downloads will be saved in: ${downloadsDir}`);
    console.log(`Access the login page at http://localhost:${port}/login`);
});

// アプリケーション終了時のクリーンアップ (オプション) 
// process.on('exit', cleanup);
// process.on('SIGINT', cleanup); // Ctrl+C などで終了した場合

// function cleanup() {
//     console.log("Cleaning up downloaded files...");
//     fs.readdir(downloadsDir, (err, files) => {
//         if (err) {
//             console.error("Error reading downloads directory:", err);
//             return;
//         }
//         for (const file of files) {
//             const filePath = path.join(downloadsDir, file);
//             fs.unlink(filePath, (unlinkErr) => {
//                 if (unlinkErr) {
//                     console.error(`Error deleting file ${filePath}:`, unlinkErr);
//                 } else {
//                     console.log(`Deleted file: ${filePath}`);
//                 }
//             });
//         }
//     });
// }
