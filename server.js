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
const ffmpeg = require('fluent-ffmpeg'); // ffmpegを追加
const urlModule = require('url');
const iconv = require('iconv-lite');
const qs = require('qs');

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
        const fileName = generateRandomFileName() + '.webm';
        const outputPath = path.join(downloadsDir, fileName);

        // yt-dlpでWebM形式に変換しながらダウンロード
        const command = `yt-dlp -f bestvideo[ext=webm]+bestaudio[ext=webm]/bestvideo+bestaudio --merge-output-format webm --output "${outputPath}" "${youtubeUrl}"`;
        console.log(`Executing yt-dlp command: ${command}`);

        exec(command, (error, stdout, stderr) => {
            if (error) {
                console.error(`yt-dlpエラー: ${stderr}`);
                reject(`yt-dlpの実行中にエラーが発生しました: ${stderr}`);
            } else {
                console.log(`yt-dlp標準出力:\n${stdout}`);
                if (fs.existsSync(outputPath)) {
                     console.log(`動画が正常にダウンロードされました (WebM): ${outputPath}`);

                     getVideoDuration(outputPath)
                         .then(durationInSeconds => {
                             const maxDelaySeconds = 7200; // 2時間
                             const calculatedDelaySeconds = durationInSeconds * 3;
                             const finalDelaySeconds = Math.min(calculatedDelaySeconds, maxDelaySeconds);
                             const finalDelayMilliseconds = finalDelaySeconds * 1000;

                             deleteVideoAfterDelay(outputPath, finalDelayMilliseconds);
                             resolve(outputPath);
                         })
                         .catch(durationError => {
                             console.error(`動画の長さ取得エラー発生、デフォルトの削除時間を適用: ${durationError}`);
                             const defaultDelayMilliseconds = 60 * 60 * 1000; // 1時間
                             deleteVideoAfterDelay(outputPath, defaultDelayMilliseconds);
                             resolve(outputPath);
                         });

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
        ffmpeg.ffprobe(filePath, (err, metadata) => {
            if (err) {
                console.error(`動画の長さ取得エラー (ffprobe): ${err.message}`);
                return reject(`動画の長さ取得エラー: ${err.message}`);
            }
            const durationInSeconds = metadata.format.duration;
            if (durationInSeconds) {
                 console.log(`動画の長さが取得されました: ${durationInSeconds} 秒`);
                 resolve(durationInSeconds);
            } else {
                 console.warn(`動画の長さがメタデータから取得できませんでした: ${filePath}`);
                 resolve(0); // 取得できない場合は0秒として扱う
            }
        });
    });
}

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
            responseType: 'arraybuffer',
            headers: {
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7',
                'Accept-Language': 'ja,en-US;q=0.9,en;q=0.8',
                'Connection': 'keep-alive',
                'Upgrade-Insecure-Requests': '1',
                ...headers,
            },
            maxRedirects: 20
        };
        if (data) {
            options.data = data;
        }

        const response = await axios(options);
        const finalUrl = response.request.responseURL || url;
        if (finalUrl !== url) {
            console.log(`Redirected from ${url} to ${finalUrl}`);
        }
        return { data: response.data, headers: response.headers, finalUrl: finalUrl };
    } catch (error) {
        console.error(`ページ取得エラー: ${error.message}`);
        if (error.response) {
            console.error(`ステータスコード: ${error.response.status}`);
            if (error.response.data instanceof Buffer) {
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
    let encoding = 'utf-8';

    const contentType = headers['content-type'];
    if (contentType) {
        const charsetMatch = contentType.match(/charset=([^;]+)/i);
        if (charsetMatch && charsetMatch[1]) {
            const determinedEncoding = charsetMatch[1].toLowerCase();
            if (iconv.encodingExists(determinedEncoding)) {
                encoding = determinedEncoding;
                console.log(`Detected encoding from Content-Type: ${encoding}`);
            } else {
                console.warn(`Unsupported encoding from Content-Type: ${determinedEncoding}, falling back to ${encoding}`);
            }
        }
    }

    if (contentType && contentType.includes('text/html')) {
        try {
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

    try {
        return iconv.decode(buffer, encoding);
    } catch (e) {
        console.error(`Failed to decode with ${encoding}, attempting utf-8:`, e);
        try {
             return iconv.decode(buffer, 'utf-8', { fatal: false, specialChars: true });
        } catch (e2) {
             console.error("Failed to decode with utf-8:", e2);
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

    const elementsWithUrls = {
        'a': 'href',
        'link': 'href',
        'img': 'src',
        'script': 'src',
        'iframe': 'src',
        'source': 'src',
        'video': 'src',
        'audio': 'src',
        'track': 'src',
    };

    Object.keys(elementsWithUrls).forEach(selector => {
        const attribute = elementsWithUrls[selector];
        $(selector).each((index, element) => {
            const $element = $(element);
            let originalUrl = $element.attr(attribute);

            if (originalUrl && !originalUrl.startsWith('data:') && !originalUrl.startsWith('#')) {
                try {
                    const resolvedUrl = urlModule.resolve(baseUrl, originalUrl);
                    const proxiedUrl = `/proxy?url=${Buffer.from(resolvedUrl).toString('base64')}`;
                    $element.attr(attribute, proxiedUrl);
                } catch (e) {
                    console.error(`URLの書き換え中にエラーが発生しました: ${originalUrl} (Base: ${baseUrl})`, e);
                }
            }
        });
    });

    $('form').each((index, element) => {
        const $element = $(element);
        let originalAction = $element.attr('action');
        const method = $element.attr('method') || 'GET';

        if (originalAction && !originalAction.startsWith('data:')) {
             try {
                const resolvedActionUrl = urlModule.resolve(baseUrl, originalAction);
                $element.attr('action', '/proxy');
                $element.attr('method', 'POST');
                $element.append(`<input type="hidden" name="__proxy_target_url" value="${Buffer.from(resolvedActionUrl).toString('base64')}">`);
                $element.append(`<input type="hidden" name="__proxy_target_method" value="${method.toUpperCase()}">`);
             } catch (e) {
                 console.error(`Form Actionの書き換え中にエラーが発生しました: ${originalAction} (Base: ${baseUrl})`, e);
             }
        } else if (!originalAction) {
             const resolvedActionUrl = baseUrl;
             $element.attr('action', '/proxy');
             $element.attr('method', 'POST');
             $element.append(`<input type="hidden" name="__proxy_target_url" value="${Buffer.from(resolvedActionUrl).toString('base64')}">`);
             $element.append(`<input type="hidden" name="__proxy_target_method" value="${method.toUpperCase()}">`);
        }
    });

    $('base').remove();

    $('style').each((index, element) => {
        const $element = $(element);
        let styleContent = $element.html();
        if (styleContent) {
            styleContent = styleContent.replace(/url\(['"]?(.*?)['"]?\)/g, (match, url) => {
                if (url && !url.startsWith('data:')) {
                    try {
                        const resolvedUrl = urlModule.resolve(baseUrl, url);
                        const proxiedUrl = `/proxy?url=${Buffer.from(resolvedUrl).toString('base64')}`;
                        return `url('${proxiedUrl}')`;
                    } catch (e) {
                         console.error(`Style URLの書き換え中にエラーが発生しました: ${url} (Base: ${baseUrl})`, e);
                         return match;
                    }
                }
                return match;
            });
            $element.html(styleContent);
        }
    });

    return $.html();
}

/**
 * CSSコンテンツ内のURLをプロキシ経由に書き換える（Base64エンコード）
 * @param {string} css - 元のCSSコンテンツ
 * @param {string} baseUrl - CSSが取得されたページのベースURL (リダイレクト後の最終URL)
 * @returns {string} URLが書き換えられたCSSコンテンツ
 */
function rewriteCssUrls(css, baseUrl) {
    const rewrittenCss = css.replace(/url\(['"]?(.*?)['"]?\)/g, (match, url) => {
        if (url && !url.startsWith('data:')) {
            try {
                const resolvedUrl = urlModule.resolve(baseUrl, url);
                const proxiedUrl = `/proxy?url=${Buffer.from(resolvedUrl).toString('base64')}`;
                return `url('${proxiedUrl}')`;
            } catch (e) {
                 console.error(`CSS URLの書き換え中にエラーが発生しました: ${url} (Base: ${baseUrl})`, e);
                 return match;
            }
        }
        return match;
    });
    return rewrittenCss;
}


function isAuthenticated(req, res, next) {
    if (req.session && req.session.authenticated) {
        return next();
    } else {
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

    if (password === SECRET_PASSWORD) {
        req.session.authenticated = true;
        res.redirect('/');
    } else {
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


// プロキシ処理 (POSTリクエスト)
app.post('/proxy', isAuthenticated, async (req, res) => {
    let targetUrl = req.body.url;
    let targetMethod = 'GET';
    let requestBody = req.body;
    let isFormSubmission = false;

    if (requestBody && requestBody.__proxy_target_url) {
        isFormSubmission = true;
        try {
            targetUrl = Buffer.from(requestBody.__proxy_target_url, 'base64').toString('utf-8');
            targetMethod = requestBody.__proxy_target_method || 'GET';
            console.log(`Received proxied form submission to: ${targetUrl} with method ${targetMethod}`);

            delete requestBody.__proxy_target_url;
            delete requestBody.__proxy_target_method;

        } catch (e) {
            console.error("Failed to decode proxy target URL or method from form data:", e);
            return res.status(400).send('Invalid proxy target information.');
        }
    } else if (!targetUrl) {
        console.error("URLが指定されていません (POST)");
        return res.redirect('/?error=' + encodeURIComponent('URLを指定してください。'));
    } else {
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

          if (!targetUrl.startsWith('http://') && !targetUrl.startsWith('https://')) {
               try {
                   const proxyBaseUrl = `${req.protocol}://${req.get('host')}/`;
                   const resolvedInitialUrl = urlModule.resolve(proxyBaseUrl, targetUrl);

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

          targetMethod = 'GET';
          requestBody = null;
    }

    const userAgent = req.headers['user-agent'];
    const referer = req.headers['referer'];

    const requestHeaders = {
        'Accept': req.headers['accept'] || 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7',
        'Accept-Language': req.headers['accept-language'] || 'ja,en-US;q=0.9,en;q=0.8',
        'User-Agent': userAgent || 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
        'Connection': 'keep-alive',
        'Upgrade-Insecure-Requests': '1',
        ...(referer && { 'Referer': referer }),
         ...Object.keys(req.headers).reduce((acc, headerName) => {
             if (!['host', 'cookie', 'content-type', 'content-length', 'connection', 'user-agent', 'referer', 'accept', 'accept-language', 'upgrade-insecure-requests'].includes(headerName.toLowerCase())) {
                  acc[headerName] = req.headers[headerName];
             }
             return acc;
         }, {})
    };

    if (targetMethod === 'POST' && requestBody) {
        requestHeaders['Content-Type'] = 'application/x-www-form-urlencoded';
        if (typeof requestBody !== 'string') {
             requestBody = qs.stringify(requestBody);
        }
    }

    try {
        const youtubeRegex = /^(https?:\/\/)?(www\.)?(youtube\.com|youtu\.be)\/.+$/;

        if (targetMethod === 'GET' && !isFormSubmission && youtubeRegex.test(targetUrl)) {
             console.log(`YouTube動画のURLが指定されました: ${targetUrl}`);
             const videoPath = await downloadVideo(targetUrl);
             const videoFileName = path.basename(videoPath);
             const videoUrl = `${req.protocol}://${req.get('host')}/video/${videoFileName}`;
             console.log(`動画ファイルへの直接URL: ${videoUrl}`);
             res.redirect(videoUrl);

        } else {
            console.log(`ターゲットURLにアクセスします (${targetMethod}): ${targetUrl}`);
            const { data: pageContentBuffer, headers, finalUrl } = await fetchWebPage(targetUrl, targetMethod, requestHeaders, requestBody);
            const contentType = headers['content-type'];

            if (contentType && contentType.includes('text/html')) {
                 const pageContent = decodeContent(pageContentBuffer, headers);
                 const rewrittenHtml = rewriteUrls(pageContent, finalUrl);
                 req.session.lastProxiedUrl = finalUrl;
                 console.log(`Saved last proxied URL to session: ${finalUrl}`);
                 res.setHeader('Content-Type', 'text/html; charset=utf-8');
                 res.send(rewrittenHtml);
            } else if (contentType && contentType.includes('text/css')) {
                 const pageContent = decodeContent(pageContentBuffer, headers);
                 const rewrittenCss = rewriteCssUrls(pageContent, finalUrl);
                 res.setHeader('Content-Type', 'text/css; charset=utf-8');
                 res.send(rewrittenCss);
            } else {
                for (const header in headers) {
                     if (header.toLowerCase() === 'content-type') {
                         const cleanContentType = contentType.replace(/;\s*charset=[^;]+/i, '');
                         if (cleanContentType.startsWith('text/')) {
                              res.setHeader('Content-Type', cleanContentType + '; charset=utf-8');
                         } else {
                              res.setHeader('Content-Type', cleanContentType);
                         }
                     } else if (header.toLowerCase() !== 'content-encoding' && header.toLowerCase() !== 'content-length') {
                         res.setHeader(header, headers[header]);
                     }
                }
                res.send(pageContentBuffer);
            }
        }
    } catch (error) {
        console.error(`処理中にエラーが発生しました (POST): ${error.message}`);
        res.redirect('/?error=' + encodeURIComponent(`処理に失敗しました: ${error.message}`));
    }
});

// プロキシ処理 (GETリクエスト)
app.get('/proxy', isAuthenticated, async (req, res) => {
    let targetUrl = req.query.url;
    const refererUrl = req.headers['referer'];

    if (!targetUrl) {
        const requestedPath = req.path;
        const lastProxiedUrl = req.session.lastProxiedUrl;

        if (lastProxiedUrl && requestedPath !== '/') {
            console.warn(`Caught potential direct relative path access: ${requestedPath}. Attempting to resolve against last proxied URL: ${lastProxiedUrl}`);
            try {
                const resolvedUrl = urlModule.resolve(lastProxiedUrl, requestedPath);
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

    try {
         const decodedUrl = Buffer.from(targetUrl, 'base64').toString('utf-8');
         if (decodedUrl && (decodedUrl.startsWith('http://') || decodedUrl.startsWith('https://'))) {
             targetUrl = decodedUrl;
             console.log(`Received Base64 encoded URL, decoded to: ${targetUrl}`);
         } else {
             console.log(`Received non-Base64 or invalid URL: ${targetUrl}`);
         }
     } catch (e) {
         console.error(`Base64 decoding failed, using original URL: ${targetUrl}`, e);
     }

    const userAgent = req.headers['user-agent'];
    const requestHeaders = {
        'Accept': req.headers['accept'] || '*/*',
        'Accept-Language': req.headers['accept-language'] || 'ja,en-US;q=0.9,en;q=0.8',
        'User-Agent': userAgent || 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
        'Connection': 'keep-alive',
        ...(refererUrl && { 'Referer': refererUrl }),
         ...(req.headers['sec-fetch-site'] && { 'Sec-Fetch-Site': req.headers['sec-fetch-site'] }),
         ...(req.headers['sec-fetch-mode'] && { 'Sec-Fetch-Mode': req.headers['sec-fetch-mode'] }),
         ...(req.headers['sec-fetch-dest'] && { 'Sec-Fetch-Dest': req.headers['sec-fetch-dest'] }),
         ...(req.headers['sec-fetch-user'] && { 'Sec-Fetch-User': req.headers['sec-fetch-user'] }),
         ...Object.keys(req.headers).reduce((acc, headerName) => {
             if (!['host', 'cookie', 'content-type', 'content-length', 'connection', 'user-agent', 'referer', 'accept', 'accept-language', 'upgrade-insecure-requests', 'sec-fetch-site', 'sec-fetch-mode', 'sec-fetch-dest', 'sec-fetch-user'].includes(headerName.toLowerCase())) {
                  acc[headerName] = req.headers[headerName];
             }
             return acc;
         }, {})
    };

    try {
        console.log(`一般的なURLにアクセスします (GET): ${targetUrl}`);
        const { data: pageContentBuffer, headers, finalUrl } = await fetchWebPage(targetUrl, 'GET', requestHeaders);
        const contentType = headers['content-type'];

        if (contentType && contentType.includes('text/html')) {
            const pageContent = decodeContent(pageContentBuffer, headers);
            const rewrittenHtml = rewriteUrls(pageContent, finalUrl);
            req.session.lastProxiedUrl = finalUrl;
            console.log(`Saved last proxied URL to session: ${finalUrl}`);
            res.setHeader('Content-Type', 'text/html; charset=utf-8');
            res.send(rewrittenHtml);
        } else if (contentType && contentType.includes('text/css')) {
            const pageContent = decodeContent(pageContentBuffer, headers);
            const rewrittenCss = rewriteCssUrls(pageContent, finalUrl);
            res.setHeader('Content-Type', 'text/css; charset=utf-8');
            res.send(rewrittenCss);
        } else {
            for (const header in headers) {
                 if (header.toLowerCase() === 'content-type') {
                     const cleanContentType = contentType.replace(/;\s*charset=[^;]+/i, '');
                     if (cleanContentType.startsWith('text/')) {
                          res.setHeader('Content-Type', cleanContentType + '; charset=utf-8');
                     } else {
                          res.setHeader('Content-Type', cleanContentType);
                     }
                 } else if (header.toLowerCase() !== 'content-encoding' && header.toLowerCase() !== 'content-length') {
                     res.setHeader(header, headers[header]);
                 }
            }
            res.send(pageContentBuffer);
        }

    } catch (error) {
        console.error(`処理中にエラーが発生しました (GET): ${error.message}`);
        res.status(500).send(`処理に失敗しました: ${error.message}`);
    }
});


// 動画ファイルのストリーミング
app.get('/video/:fileName', isAuthenticated, (req, res) => {
    const fileName = req.params.fileName;
    const filePath = path.join(downloadsDir, fileName);

    fs.stat(filePath, (err, stat) => {
        if (err) {
            console.error(`動画ファイルが見つからないか、アクセスできません: ${filePath}`, err);
            return res.status(404).send("動画ファイルが見つかりません");
        }

        const fileSize = stat.size;
        const range = req.headers.range;

        if (range) {
            const parts = range.replace(/bytes=/, "").split("-");
            const start = parseInt(parts[0], 10);
            const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
            const chunkSize = (end - start) + 1;

            const fileStream = fs.createReadStream(filePath, { start, end });

            res.writeHead(206, {
                "Content-Range": `bytes ${start}-${end}/${fileSize}`,
                "Accept-Ranges": "bytes",
                "Content-Length": chunkSize,
                "Content-Type": "video/webm",
            });

            fileStream.pipe(res);

            fileStream.on('end', () => {
                console.log('Range stream finished');
                res.end();
            });

            fileStream.on('error', (streamErr) => {
                console.error(`ファイルストリームエラー: ${streamErr.message}`);
                res.sendStatus(500);
            });

        } else {
            const stream = fs.createReadStream(filePath);
            res.writeHead(200, {
                "Content-Length": fileSize,
                "Content-Type": "video/webm",
                "Accept-Ranges": "bytes",
            });

            stream.pipe(res);

            stream.on('end', () => {
                console.log('Full stream finished');
                res.end();
            });

            stream.on('error', (streamErr) => {
                console.error(`Stream error: ${streamErr.message}`);
                res.sendStatus(500);
            });
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
