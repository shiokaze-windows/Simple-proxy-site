const express = require('express');
const axios = require('axios');
const cheerio = require('cheerio'); // Cheerioを追加
const cookieParser = require('cookie-parser');
const session = require('express-session');
const { exec } = require('child_process'); // yt-dlp用
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { promisify } = require('util');
const { unlink } = require('fs').promises;
const ffmpeg = require('fluent-ffmpeg');
const urlModule = require('url'); // URLモジュールを追加
const iconv = require('iconv-lite'); // iconv-liteを追加
const qs = require('qs'); // クエリ文字列の処理のためにqsを追加

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
 * 動画ファイルの長さを取得 (現在は未使用)
 * @param {string} filePath - 動画ファイルの絶対パス
 * @returns {Promise<number>} 動画の長さ（秒単位）
 */
// function getVideoDuration(filePath) {
//     return new Promise((resolve, reject) => {
//         ffmpeg.ffprobe(filePath, (err, metadata) => {
//             if (err) {
//                 console.error(`動画の長さ取得エラー (ffprobe): ${err.message}`);
//                 return reject(`動画の長さ取得エラー: ${err.message}`);
//             }
//             const durationInSeconds = metadata.format.duration;
//             if (durationInSeconds) {
//                  resolve(durationInSeconds);
//             } else {
//                  console.warn(`動画の長さがメタデータから取得できませんでした: ${filePath}`);
//                  resolve(0);
//             }
//         });
//     });
// }

/**
 * ウェブサイトのコンテンツを取得
 * @param {string} url - 取得するウェブサイトのURL。
 * @param {string} method - HTTPメソッド (GET, POSTなど)。
 * @param {object} headers - リクエストに含めるヘッダー。
 * @param {any} data - POSTリクエストのボディデータ。
 * @returns {Promise<{data: Buffer, headers: object, finalUrl: string}>} ウェブサイトのコンテンツ、ヘッダー、リダイレクト後の最終URL（データはBuffer）。
 */
async function fetchWebPage(url, method = 'GET', headers = {}, data = null) {
    try {
        const options = {
            method: method,
            url: url,
            responseType: 'arraybuffer', // arraybufferで取得してバイナリも扱えるように
            headers: {
                // デフォルトヘッダーを設定し、渡されたヘッダーで上書き
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7',
                'Accept-Language': 'ja,en-US;q=0.9,en;q=0.8',
                'Connection': 'keep-alive',
                'Upgrade-Insecure-Requests': '1',
                // Refererは呼び出し元で設定されることを想定
                ...headers,
            },
            maxRedirects: 20 // 最大リダイレクト数を設定 (デフォルトは20)
        };
        if (data) {
            options.data = data; // POSTデータ
        }

        const response = await axios(options);

        // リダイレクト後の最終的なURLを取得
        // axios 1.x以降では response.request.res.responseUrl ではなく response.request.responseURL を使用
        const finalUrl = response.request.responseURL || url;
        if (finalUrl !== url) {
            console.log(`Redirected from ${url} to ${finalUrl}`);
        }


        return { data: response.data, headers: response.headers, finalUrl: finalUrl };
    } catch (error) {
        console.error(`ページ取得エラー: ${error.message}`);
        // エラー詳細をログに出力
        if (error.response) {
            console.error(`ステータスコード: ${error.response.status}`);
            // レスポンスデータがバッファの場合、文字列に変換して表示
            if (error.response.data instanceof Buffer) {
                // エラーメッセージのデコードを試みる（エンコーディング不明のためUTF-8で試行）
                try {
                    console.error(`レスポンスデータ: ${iconv.decode(error.response.data, 'utf-8')}`);
                } catch (e) {
                    console.error(`レスポンスデータ (デコード失敗): ${error.response.data.toString('hex')}`);
                }
            } else {
                 console.error(`レスポンスデータ: ${error.response.data}`);
            }
            console.error(`レスポンスヘッダー: ${JSON.stringify(error.response.headers)}`);
        } else if (error.request) {
            console.error('リクエストは行われませんでしたが、応答がありませんでした');
            console.error(error.request);
        } else {
            console.error('リクエストの設定中にエラーが発生しました');
        }
        throw new Error(`ページ取得エラー: ${error.message}`);
    }
}

/**
 * コンテンツのエンコーディングを判別し、デコードする
 * @param {Buffer} buffer - デコードするBufferデータ
 * @param {object} headers - 応答ヘッダー
 * @returns {string} デコードされた文字列
 */
function decodeContent(buffer, headers) {
    let encoding = 'utf-8'; // デフォルトエンコーディング

    // 1. Content-Typeヘッダーからcharsetを取得
    const contentType = headers['content-type'];
    if (contentType) {
        const charsetMatch = contentType.match(/charset=([^;]+)/i);
        if (charsetMatch && charsetMatch[1]) {
            const determinedEncoding = charsetMatch[1].toLowerCase();
            // iconv-liteがサポートしているか確認
            if (iconv.encodingExists(determinedEncoding)) {
                encoding = determinedEncoding;
                console.log(`Detected encoding from Content-Type: ${encoding}`);
            } else {
                console.warn(`Unsupported encoding from Content-Type: ${determinedEncoding}, falling back to ${encoding}`);
            }
        }
    }

    // 2. HTMLの場合、metaタグからcharsetを取得（Content-Typeより優先）
    // Bufferの先頭部分をUTF-8として仮デコードしてmetaタグを探す
    if (contentType && contentType.includes('text/html')) {
        try {
            // 最初の数KBだけを仮デコードしてmetaタグを探す（パフォーマンスのため）
            const tempHtml = iconv.decode(buffer.slice(0, 4096), 'utf-8', { fatal: false, specialChars: true });
            const charsetMetaMatch = tempHtml.match(/<meta\s+[^>]*charset=["']?([^"' >]+)["']?/i);
            if (charsetMetaMatch && charsetMetaMatch[1]) {
                const determinedEncoding = charsetMetaMatch[1].toLowerCase();
                 if (iconv.encodingExists(determinedEncoding)) {
                    encoding = determinedEncoding;
                    console.log(`Detected encoding from meta tag: ${encoding}`);
                } else {
                    console.warn(`Unsupported encoding from meta tag: ${determinedEncoding}, falling back to ${encoding}`);
                }
            }
        } catch (e) {
            console.error("Error detecting encoding from meta tag:", e);
        }
    }

    // 3. 判別したエンコーディングでデコード
    try {
        return iconv.decode(buffer, encoding);
    } catch (e) {
        console.error(`Failed to decode with ${encoding}, attempting utf-8:`, e);
        // デコードに失敗した場合、UTF-8で再試行
        try {
             return iconv.decode(buffer, 'utf-8', { fatal: false, specialChars: true });
        } catch (e2) {
             console.error("Failed to decode with utf-8:", e2);
             // 最終手段として、強制的にUTF-8として扱う（文字化けする可能性あり）
             return buffer.toString('utf-8');
        }
    }
}


/**
 * HTMLコンテンツ内のURLとフォームをプロキシ経由に書き換える（Base64エンコード）
 * @param {string} html - 元のHTMLコンテンツ
 * @param {string} baseUrl - HTMLが取得されたページのベースURL (リダイレクト後の最終URL)
 * @returns {string} URLが書き換えられたHTMLコンテンツ
 */
function rewriteUrls(html, baseUrl) {
    const $ = cheerio.load(html);

    // URLを含む可能性のあるタグと属性
    const elementsWithUrls = {
        'a': 'href',
        'link': 'href',
        'img': 'src',
        'script': 'src',
        // formは特別扱い
        'iframe': 'src',
        'source': 'src',
        'video': 'src',
        'audio': 'src',
        'track': 'src',
        // style属性内のURLはより複雑な解析が必要なため、ここでは対象外とします
    };

    Object.keys(elementsWithUrls).forEach(selector => {
        const attribute = elementsWithUrls[selector];
        $(selector).each((index, element) => {
            const $element = $(element);
            let originalUrl = $element.attr(attribute);

            if (originalUrl && !originalUrl.startsWith('data:') && !originalUrl.startsWith('#')) { // data URLとフラグメント識別子はスキップ
                try {
                    // 絶対URLに解決
                    const resolvedUrl = urlModule.resolve(baseUrl, originalUrl);

                    // デバッグログを追加
                    // console.log(`[Rewrite Debug] Base: ${baseUrl}, Original: ${originalUrl}, Resolved: ${resolvedUrl}`);

                    // プロキシ経由のURLに書き換え (Base64エンコード)
                    const proxiedUrl = `/proxy?url=${Buffer.from(resolvedUrl).toString('base64')}`;
                    $element.attr(attribute, proxiedUrl);

                    // console.log(`Rewrote URL: ${originalUrl} -> ${resolvedUrl} -> ${proxiedUrl}`);

                } catch (e) {
                    console.error(`URLの書き換え中にエラーが発生しました: ${originalUrl} (Base: ${baseUrl})`, e);
                    // エラーが発生した場合は元のURLを残すか、空にするか検討
                    // ここでは元のURLをそのまま残します
                }
            }
        });
    });

    // フォームタグのaction属性を書き換え
    $('form').each((index, element) => {
        const $element = $(element);
        let originalAction = $element.attr('action');
        const method = $element.attr('method') || 'GET'; // methodが指定されていない場合はGETとみなす

        if (originalAction && !originalAction.startsWith('data:')) {
             try {
                // 絶対URLに解決
                const resolvedActionUrl = urlModule.resolve(baseUrl, originalAction);

                // デバッグログを追加
                // console.log(`[Form Rewrite Debug] Base: ${baseUrl}, Original Action: ${originalAction}, Resolved Action: ${resolvedActionUrl}`);


                // フォームのactionをプロキシのURLに書き換え
                $element.attr('action', '/proxy');
                // methodはPOSTに強制変更 (フォームデータをボディに含めるため)
                $element.attr('method', 'POST');

                // 元のaction URLとmethodを隠しフィールドとして追加
                $element.append(`<input type="hidden" name="__proxy_target_url" value="${Buffer.from(resolvedActionUrl).toString('base64')}">`);
                $element.append(`<input type="hidden" name="__proxy_target_method" value="${method.toUpperCase()}">`);

                console.log(`Rewrote Form Action: ${originalAction} -> ${resolvedActionUrl} -> /proxy (Method: ${method.toUpperCase()})`);

             } catch (e) {
                 console.error(`Form Actionの書き換え中にエラーが発生しました: ${originalAction} (Base: ${baseUrl})`, e);
                 // エラーが発生した場合は元のactionを残すか、空にするか検討
                 // ここでは元のactionをそのまま残します
             }
        } else if (!originalAction) {
             // action属性がない場合は、現在のページURLがactionとなる
             const resolvedActionUrl = baseUrl;
             // デバッグログを追加
             // console.log(`[Form Rewrite Debug] Base: ${baseUrl}, Original Action (empty): ${originalAction}, Resolved Action: ${resolvedActionUrl}`);

             $element.attr('action', '/proxy');
             $element.attr('method', 'POST'); // POSTに強制変更
             $element.append(`<input type="hidden" name="__proxy_target_url" value="${Buffer.from(resolvedActionUrl).toString('base64')}">`);
             $element.append(`<input type="hidden" name="__proxy_target_method" value="${method.toUpperCase()}">`);
             console.log(`Rewrote Form Action (empty): ${resolvedActionUrl} -> /proxy (Method: ${method.toUpperCase()})`);
        }
    });


     // <base> タグが存在する場合、そのhrefも書き換えるか削除する必要がある場合がありますが、
     // シンプルなプロキシでは問題を起こす可能性があるため、ここでは削除します。
     $('base').remove();


    // スタイルタグ内のURL (background-imageなど) を書き換える試み
    // これは簡易的なもので、複雑なCSSには対応できません
    $('style').each((index, element) => {
        const $element = $(element);
        let styleContent = $element.html();
        if (styleContent) {
            // url(...) パターンを見つけて書き換え
            styleContent = styleContent.replace(/url\(['"]?(.*?)['"]?\)/g, (match, url) => {
                if (url && !url.startsWith('data:')) {
                    try {
                        const resolvedUrl = urlModule.resolve(baseUrl, url);
                         // デバッグログを追加
                        // console.log(`[Style Rewrite Debug] Base: ${baseUrl}, Original: ${url}, Resolved: ${resolvedUrl}`);

                        // プロキシ経由のURLに書き換え (Base64エンコード)
                        const proxiedUrl = `/proxy?url=${Buffer.from(resolvedUrl).toString('base64')}`;
                        // 元の形式を維持して書き換え (例: url('...') -> url('/proxy?url=...'))
                        return `url('${proxiedUrl}')`;
                    } catch (e) {
                         console.error(`Style URLの書き換え中にエラーが発生しました: ${url} (Base: ${baseUrl})`, e);
                         return match; // 書き換え失敗時は元のまま
                    }
                }
                return match; // data URLなどはそのまま
            });
            $element.html(styleContent);
        }
    });


    return $.html(); // 書き換え後のHTMLを返す
}

/**
 * CSSコンテンツ内のURLをプロキシ経由に書き換える（Base64エンコード）
 * @param {string} css - 元のCSSコンテンツ
 * @param {string} baseUrl - CSSが取得されたページのベースURL (リダイレクト後の最終URL)
 * @returns {string} URLが書き換えられたCSSコンテンツ
 */
function rewriteCssUrls(css, baseUrl) {
    // url(...) パターンを見つけて書き換え
    const rewrittenCss = css.replace(/url\(['"]?(.*?)['"]?\)/g, (match, url) => {
        if (url && !url.startsWith('data:')) { // data URLはスキップ
            try {
                // 絶対URLに解決
                const resolvedUrl = urlModule.resolve(baseUrl, url);
                 // デバッグログを追加
                // console.log(`[CSS Rewrite Debug] Base: ${baseUrl}, Original: ${url}, Resolved: ${resolvedUrl}`);

                // プロキシ経由のURLに書き換え (Base64エンコード)
                const proxiedUrl = `/proxy?url=${Buffer.from(resolvedUrl).toString('base64')}`;
                // 元の形式を維持して書き換え (例: url('...') -> url('/proxy?url=...'))
                return `url('${proxiedUrl}')`;
            } catch (e) {
                 console.error(`CSS URLの書き換え中にエラーが発生しました: ${url} (Base: ${baseUrl})`, e);
                 return match; // 書き換え失敗時は元のまま
            }
        }
        return match; // data URLなどはそのまま
    });
    return rewrittenCss;
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
                button { padding: 10px 20px; background-color: #007bff; color: white; border: none; border-radius: 4曆px; cursor: pointer; font-size: 1rem; transition: background-color 0.3s ease; }
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
                    <input type="text" name="url" placeholder="URLを入力 (例: https://www.google.com)" required>
                    <button type="submit">アクセス</button>
                </form>
                <p>注意: 動画のストリーミングには少し時間がかかる場合があります。</p>
                 ${req.query.error ? `<p class="error">${req.query.error}</p>` : ''} </div>
        </body>
        </html>
    `);
});


// プロキシ処理 (POSTリクエスト - トップページからの初回アクセス または フォーム送信)
app.post('/proxy', isAuthenticated, async (req, res) => {
    let targetUrl = req.body.url;
    let targetMethod = 'GET'; // デフォルトはGET
    let requestBody = req.body; // フォームデータを含む可能性があるボディ
    let isFormSubmission = false; // フォーム送信フラグ

    // フォーム送信からのリクエストか判定
    if (requestBody && requestBody.__proxy_target_url) {
        isFormSubmission = true;
        // フォーム送信からのリクエストの場合
        try {
            targetUrl = Buffer.from(requestBody.__proxy_target_url, 'base64').toString('utf-8');
            targetMethod = requestBody.__proxy_target_method || 'GET';
            console.log(`Received proxied form submission to: ${targetUrl} with method ${targetMethod}`);

            // プロキシ用の隠しフィールドをデータから削除
            delete requestBody.__proxy_target_url;
            delete requestBody.__proxy_target_method;

        } catch (e) {
            console.error("Failed to decode proxy target URL or method from form data:", e);
            return res.status(400).send('Invalid proxy target information.');
        }
    } else if (!targetUrl) {
        // トップページからの初回アクセスでURLがない場合
        console.error("URLが指定されていません (POST)");
        return res.redirect('/?error=' + encodeURIComponent('URLを指定してください。'));
    } else {
         // トップページからの初回アクセスでURLがある場合
         // 受け取ったURLがBase64エンコードされているかチェックし、デコードを試みる
         try {
              const decodedUrl = Buffer.from(targetUrl, 'base64').toString('utf-8');
              if (decodedUrl && (decodedUrl.startsWith('http://') || decodedUrl.startsWith('https://'))) {
                  targetUrl = decodedUrl;
                  console.log(`Received Base64 encoded URL (initial), decoded to: ${targetUrl}`);
              } else {
                  console.log(`Received non-Base64 or invalid URL (initial): ${targetUrl}`);
              }
          } catch (e) {
              console.error(`Base64 decoding failed (initial), using original URL: ${targetUrl}`, e);
          }

          // 初期アクセスURLが相対パスの場合の解決
          if (!targetUrl.startsWith('http://') && !targetUrl.startsWith('https://')) {
               try {
                   const proxyBaseUrl = `${req.protocol}://${req.get('host')}/`;
                   const resolvedInitialUrl = urlModule.resolve(proxyBaseUrl, targetUrl);

                   // 解決されたURLが有効な形式か再確認
                   if (resolvedInitialUrl.startsWith('http://') || resolvedInitialUrl.startsWith('https://')) {
                       targetUrl = resolvedInitialUrl;
                       console.log(`Resolved initial input relative URL: ${targetUrl}`);
                   } else {
                       console.error(`Invalid initial input URL after resolution: ${resolvedInitialUrl}`);
                       return res.redirect('/?error=' + encodeURIComponent('無効なURL形式です。フルURLを入力してください。'));
                   }
               } catch (e) {
                   console.error(`Error resolving initial input URL: ${targetUrl}`, e);
                   return res.redirect('/?error=' + encodeURIComponent('URLの解決中にエラーが発生しました。'));
               }
          }


          targetMethod = 'GET'; // 初回アクセスはGETとして扱う
          requestBody = null; // 初回アクセスにボディデータはない
    }


    // クライアントのUser-Agentを取得
    const userAgent = req.headers['user-agent'];
    // フォーム送信の場合はRefererを元のページのURLに設定する方が適切かもしれないが、
    // ここではシンプルにクライアントのRefererをそのまま引き継ぐ
    const referer = req.headers['referer'];

    const requestHeaders = {
        // デフォルトヘッダーを設定し、クライアントからのヘッダーで上書き
        'Accept': req.headers['accept'] || 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7',
        'Accept-Language': req.headers['accept-language'] || 'ja,en-US;q=0.9,en;q=0.8',
        'User-Agent': userAgent || 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36', // デフォルトUser-Agent
        'Connection': 'keep-alive',
        'Upgrade-Insecure-Requests': '1',
        // Refererヘッダーを追加 (存在する場合のみ)
        ...(referer && { 'Referer': referer }),
        // クライアントからの他のヘッダーも可能な限り引き継ぐ (Host, Cookie, Content-Type, Content-Lengthを除く)
         ...Object.keys(req.headers).reduce((acc, headerName) => {
             if (!['host', 'cookie', 'content-type', 'content-length', 'connection', 'user-agent', 'referer', 'accept', 'accept-language', 'upgrade-insecure-requests'].includes(headerName.toLowerCase())) {
                  acc[headerName] = req.headers[headerName];
             }
             return acc;
         }, {})
    };

    // POSTの場合、Content-Typeヘッダーを設定
    if (targetMethod === 'POST' && requestBody) {
        // フォームデータのContent-Typeを適切に設定
        // ここではapplication/x-www-form-urlencodedを想定
        requestHeaders['Content-Type'] = 'application/x-www-form-urlencoded';
        // requestBodyをクエリ文字列形式に変換
        // requestBodyはすでにqs.stringifyされているか、そのままのオブジェクト形式を想定
        if (typeof requestBody !== 'string') {
             requestBody = qs.stringify(requestBody);
        }
    }


    try {
        // YouTubeのURLかどうかを判定 (初回アクセス時かつGETメソッドの場合のみ)
        const youtubeRegex = /^(https?:\/\/)?(www\.)?(youtube\.com|youtu\.be)\/.+$/;

        if (targetMethod === 'GET' && !isFormSubmission && youtubeRegex.test(targetUrl)) {
             console.log(`YouTube動画のURLが指定されました: ${targetUrl}`);
             // yt-dlpを使って動画をWebM形式で保存
             const videoPath = await downloadVideo(targetUrl);

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
            console.log(`ターゲットURLにアクセスします (${targetMethod}): ${targetUrl}`);
            // User-Agentヘッダーを含めてページを取得し、最終URLも取得
            const { data: pageContentBuffer, headers, finalUrl } = await fetchWebPage(targetUrl, targetMethod, requestHeaders, requestBody);

            // Content-Typeを確認
            const contentType = headers['content-type'];

            // HTMLの場合
            if (contentType && contentType.includes('text/html')) {
                 const pageContent = decodeContent(pageContentBuffer, headers); // エンコーディングを判別してデコード
                 // リダイレクト後の最終URLをbaseUrlとして使用
                 const rewrittenHtml = rewriteUrls(pageContent, finalUrl);

                 // 正常にHTMLを取得・処理できた場合、最終URLをセッションに保存
                 req.session.lastProxiedUrl = finalUrl;
                 console.log(`Saved last proxied URL to session: ${finalUrl}`);

                 res.setHeader('Content-Type', 'text/html; charset=utf-8'); // クライアントにはUTF-8として返す
                 res.send(rewrittenHtml);
            }
            // CSSの場合
            else if (contentType && contentType.includes('text/css')) {
                 const pageContent = decodeContent(pageContentBuffer, headers); // エンコーディングを判別してデコード
                 // リダイレクト後の最終URLをbaseUrlとして使用
                 const rewrittenCss = rewriteCssUrls(pageContent, finalUrl);

                 // CSSの場合は最終URLをセッションに保存する必要はないかもしれないが、念のため
                 // req.session.lastProxiedUrl = finalUrl; // CSSの場合は不要

                 res.setHeader('Content-Type', 'text/css; charset=utf-8'); // クライアントにはUTF-8として返す
                 res.send(rewrittenCss);
            }
            // その他のコンテンツ（画像、JSなど）
            else {
                // 元のContent-Typeヘッダーを設定（charsetは削除またはUTF-8に置き換えるのが安全）
                for (const header in headers) {
                     if (header.toLowerCase() === 'content-type') {
                         // charsetを削除またはUTF-8に置き換える
                         const cleanContentType = contentType.replace(/;\s*charset=[^;]+/i, '');
                         // テキスト系リソース以外の場合はcharset=utf-8を追加しない方が良い場合がある
                         if (cleanContentType.startsWith('text/')) {
                              res.setHeader('Content-Type', cleanContentType + '; charset=utf-8');
                         } else {
                              res.setHeader('Content-Type', cleanContentType);
                         }
                     } else if (header.toLowerCase() !== 'content-encoding' && header.toLowerCase() !== 'content-length') {
                         res.setHeader(header, headers[header]);
                     }
                }
                res.send(pageContentBuffer); // Bufferのままsend
            }
        }
    } catch (error) {
        console.error(`処理中にエラーが発生しました (POST): ${error.message}`);
        res.redirect('/?error=' + encodeURIComponent(`処理に失敗しました: ${error.message}`));
    }
});

// プロキシ処理 (GETリクエスト - 書き換えられたリンクやリソースのアクセス、または誤った相対URLアクセス)
app.get('/proxy', isAuthenticated, async (req, res) => {
    let targetUrl = req.query.url; // クエリパラメータからURLを取得
    // リソースのリクエスト元のページのURLをRefererとして使用するために取得
    const refererUrl = req.headers['referer'];


    if (!targetUrl) {
        // クエリパラメータにurlがない場合、誤った相対URLアクセスとみなす
        const requestedPath = req.path; // 例: /a/KADOKAWA

        // セッションから最後にアクセスしたページのURLを取得
        const lastProxiedUrl = req.session.lastProxiedUrl;

        if (lastProxiedUrl && requestedPath !== '/') { // lastProxiedUrlがあり、かつルートパスへのアクセスでない場合
            console.warn(`Caught potential direct relative path access: ${requestedPath}. Attempting to resolve against last proxied URL: ${lastProxiedUrl}`);
            try {
                // 最後にアクセスしたページのURLをベースに、リクエストされた相対パスを解決
                const resolvedUrl = urlModule.resolve(lastProxiedUrl, requestedPath);

                // 解決されたURLをBase64エンコードして、正しいプロキシURLにリダイレクト
                const correctProxiedUrl = `/proxy?url=${Buffer.from(resolvedUrl).toString('base64')}`;
                console.log(`Redirecting to correct proxied URL: ${correctProxiedUrl}`);
                return res.redirect(correctProxiedUrl);

            } catch (e) {
                console.error(`Error resolving relative path ${requestedPath} against ${lastProxiedUrl}:`, e);
                return res.status(500).send(`Error resolving relative path.`);
            }
        } else {
            console.error("URLが指定されていません (GET) and no last proxied URL in session.");
            return res.status(400).send('URLを指定してください。またはセッション情報がありません。');
        }
    }

    // クエリパラメータにurlがある場合（通常のプロキシリクエスト）
    // 受け取ったURLがBase64エンコードされているかチェックし、デコードを試みる
    try {
         // Base64デコードを試みる
         const decodedUrl = Buffer.from(targetUrl, 'base64').toString('utf-8');
         // デコードが成功し、かつ有効なURLの形式であれば、デコード後のURLを使用
         if (decodedUrl && (decodedUrl.startsWith('http://') || decodedUrl.startsWith('https://'))) {
             targetUrl = decodedUrl;
             console.log(`Received Base64 encoded URL, decoded to: ${targetUrl}`);
         } else {
             // デコードに失敗した場合や、デコード結果がURL形式でない場合は元のURLを使用
             console.log(`Received non-Base64 or invalid URL: ${targetUrl}`);
         }
     } catch (e) {
         // Base64デコードでエラーが発生した場合も元のURLを使用
         console.error(`Base64 decoding failed, using original URL: ${targetUrl}`, e);
     }

    // クライアントのUser-Agentを取得
    const userAgent = req.headers['user-agent'];
    const requestHeaders = {
        // デフォルトヘッダーを設定し、クライアントからのヘッダーで上書き
        'Accept': req.headers['accept'] || '*/*', // リソース取得なのでAcceptはワイルドカードが適切かも
        'Accept-Language': req.headers['accept-language'] || 'ja,en-US;q=0.9,en;q=0.8',
        'User-Agent': userAgent || 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36', // デフォルトUser-Agent
        'Connection': 'keep-alive',
        // Refererヘッダーを追加 (存在する場合のみ)
        ...(refererUrl && { 'Referer': refererUrl }),
         // Sec-Fetch-* ヘッダーを追加 (存在する場合のみ)
         ...(req.headers['sec-fetch-site'] && { 'Sec-Fetch-Site': req.headers['sec-fetch-site'] }),
         ...(req.headers['sec-fetch-mode'] && { 'Sec-Fetch-Mode': req.headers['sec-fetch-mode'] }),
         ...(req.headers['sec-fetch-dest'] && { 'Sec-Fetch-Dest': req.headers['sec-fetch-dest'] }),
         ...(req.headers['sec-fetch-user'] && { 'Sec-Fetch-User': req.headers['sec-fetch-user'] }),
        // クライアントからの他のヘッダーも可能な限り引き継ぐ (Host, Cookie, Content-Type, Content-Lengthを除く)
         ...Object.keys(req.headers).reduce((acc, headerName) => {
             if (!['host', 'cookie', 'content-type', 'content-length', 'connection', 'user-agent', 'referer', 'accept', 'accept-language', 'upgrade-insecure-requests', 'sec-fetch-site', 'sec-fetch-mode', 'sec-fetch-dest', 'sec-fetch-user'].includes(headerName.toLowerCase())) {
                  acc[headerName] = req.headers[headerName];
             }
             return acc;
         }, {})
    };


    try {
        // YouTubeのURLはPOSTで処理される想定なので、ここでは一般的なURLとして扱う
        console.log(`一般的なURLにアクセスします (GET): ${targetUrl}`);
        // User-Agentヘッダーを含めてページを取得し、最終URLも取得
        const { data: pageContentBuffer, headers, finalUrl } = await fetchWebPage(targetUrl, 'GET', requestHeaders); // GETメソッドを指定

        // Content-Typeを確認
        const contentType = headers['content-type'];

        // HTMLの場合
        if (contentType && contentType.includes('text/html')) {
            const pageContent = decodeContent(pageContentBuffer, headers); // エンコーディングを判別してデコード
            // リダイレクト後の最終URLをbaseUrlとして使用
            const rewrittenHtml = rewriteUrls(pageContent, finalUrl);

            // 正常にHTMLを取得・処理できた場合、最終URLをセッションに保存
            req.session.lastProxiedUrl = finalUrl;
            console.log(`Saved last proxied URL to session: ${finalUrl}`);

            res.setHeader('Content-Type', 'text/html; charset=utf-8'); // クライアントにはUTF-8として返す
            res.send(rewrittenHtml);
        }
        // CSSの場合
        else if (contentType && contentType.includes('text/css')) {
            const pageContent = decodeContent(pageContentBuffer, headers); // エンコーディングを判別してデコード
            // リダイレクト後の最終URLをbaseUrlとして使用
            const rewrittenCss = rewriteCssUrls(pageContent, finalUrl);
            res.setHeader('Content-Type', 'text/css; charset=utf-8'); // クライアントにはUTF-8として返す
            res.send(rewrittenCss);
        }
        // その他のコンテンツ（画像、JSなど）
        else {
            // 元のContent-Typeヘッダーを設定（charsetは削除またはUTF-8に置き換えるのが安全）
            for (const header in headers) {
                 if (header.toLowerCase() === 'content-type') {
                     // charsetを削除またはUTF-8に置き換える
                     const cleanContentType = contentType.replace(/;\s*charset=[^;]+/i, '');
                     // テキスト系リソース以外の場合はcharset=utf-8を追加しない方が良い場合がある
                     if (cleanContentType.startsWith('text/')) {
                          res.setHeader('Content-Type', cleanContentType + '; charset=utf-8');
                     } else {
                          res.setHeader('Content-Type', cleanContentType);
                     }
                 } else if (header.toLowerCase() !== 'content-encoding' && header.toLowerCase() !== 'content-length') {
                     res.setHeader(header, headers[header]);
                 }
            }
            res.send(pageContentBuffer); // Bufferのままsend
        }

    } catch (error) {
        console.error(`処理中にエラーが発生しました (GET): ${error.message}`);
        res.status(500).send(`処理に失敗しました: ${error.message}`);
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
                "Content-Type": "video/webm"
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
