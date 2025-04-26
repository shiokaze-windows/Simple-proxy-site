// Node.jsのモジュールと外部ライブラリのインポート
// これらのモジュールは、ウェブサーバーの構築、HTTPリクエスト、ファイルシステム操作、外部プロセスの実行、データ変換など、
// 本アプリケーションの様々な機能を実現するために必要です。
const express = require('express'); // 高速でミニマルなWebアプリケーションフレームワーク
const axios = require('axios'); // PromiseベースのHTTPクライアント。サーバーから外部のURLへリクエストを送信するために使用。
const cheerio = require('cheerio'); // サーバーサイドでのDOM操作ライブラリ。取得したHTMLコンテンツを解析・操作するために使用。
const cookieParser = require('cookie-parser'); // リクエストヘッダーからCookieをパースし、req.cookiesとしてアクセス可能にするミドルウェア。
const session = require('express-session'); // セッション管理ミドルウェア。ユーザーの状態（ログイン情報など）をサーバーサイドで維持するために使用。
const { exec } = require('child_process'); // 新しいプロセスを生成し、コマンドを実行するためのモジュール。ここではyt-dlpを実行するために使用。
const fs = require('fs'); // ファイルシステム操作モジュール。ファイルの読み書き、ディレクトリ作成などに使用。
const path = require('path'); // ファイルパス操作ユーティリティ。パスの結合や正規化に使用。
const crypto = require('crypto'); // 暗号化関連モジュール。ここではランダムなバイト列生成に使用。
const { promisify } = require('util'); // Node.jsのコールバックベースの関数をPromiseを返す関数に変換するユーティリティ。
const { unlink } = require('fs').promises; // fsモジュールのunlink関数（ファイル削除）をPromiseとして取得。async/awaitで使用。
const ffmpeg = require('fluent-ffmpeg'); // ffmpegのラッパーライブラリ。動画/音声ファイルの操作や情報取得に使用。ここでは動画の長さ取得に使用。
const urlModule = require('url'); // URLの解析、フォーマット、解決（相対URLを絶対URLに変換）に使用。
const iconv = require('iconv-lite'); // 様々な文字エンコーディングの変換をサポートするライブラリ。取得したコンテンツの文字化け対策に使用。
const qs = require('qs'); // クエリ文字列のパースと文字列化を行うライブラリ。フォームデータの処理に使用。

// Expressアプリケーションインスタンスの作成
const app = express();
const port = 3000; // サーバーがリッスンするポート番号

// 認証設定
// 実際のアプリケーションでは、これらの秘密情報は環境変数など、より安全な方法で管理すべきです。
const SECRET_PASSWORD = '56562'; // ログイン認証に使用するパスワード。要変更。
const SESSION_SECRET = 'ugud6fddtd77785rthytyujh'; // セッションIDの署名に使用する秘密鍵。セッションハイジャックを防ぐために重要。要変更。

// ダウンロードディレクトリの準備
// スクリプト実行ディレクトリ直下に 'downloads' ディレクトリを作成します。
const downloadsDir = path.join(__dirname, 'downloads');
if (!fs.existsSync(downloadsDir)){ // ディレクトリが存在するか確認
    fs.mkdirSync(downloadsDir); // 存在しない場合は同期的に作成
}

// ミドルウェアの設定
// 全てのリクエストに対して共通の前処理を行います。
app.use(express.json()); // Content-Typeがapplication/jsonのリクエストボディをパース。
app.use(express.urlencoded({ extended: true })); // Content-Typeがapplication/x-www-form-urlencodedのリクエストボディをパース。extended: trueでネストされたオブジェクトや配列も扱えるようにします。
app.use(cookieParser()); // リクエストのCookieをパースし、req.cookiesオブジェクトとして利用可能にします。
app.use(session({ // セッションミドルウェアの設定
    secret: SESSION_SECRET, // セッションIDの署名に使用する秘密鍵
    resave: false, // セッションがリクエスト中に変更されなかった場合でも強制的にセッションストアに保存し直すか。通常はfalseで効率が良い。
    saveUninitialized: true, // 未初期化（新しいが変更されていない）セッションをセッションストアに保存するか。trueにすると、セッションが作成された直後からセッションIDがクライアントに発行されます。
    cookie: { maxAge: 60 * 60 * 1000, secure: false } // セッションCookieの設定。maxAgeは有効期限（ミリ秒）。secure: falseはHTTPSでない接続でもCookieを送信することを許可します（開発環境向け）。本番環境ではtrueにすべきです。
}));

// child_process.exec を Promise 化
// これにより、コールバック地獄を避け、async/await構文で外部コマンド実行を記述しやすくなります。
const execPromise = promisify(exec);

// ランダムなファイル名生成関数
// ダウンロードされるファイル名の一意性を保証し、推測されにくくします。
function generateRandomFileName() {
    // 16バイトのランダムなバイト列を生成し、16進数文字列に変換します。
    // 1バイトは2桁の16進数で表されるため、16バイトは32桁の文字列になります。
    return crypto.randomBytes(16).toString('hex');
}

/**
 * 指定されたファイルを非同期で遅延削除する関数。
 * ファイルが存在しない場合のエラーも適切に処理します。
 * @param {string} filePath - 削除対象ファイルの絶対パス。
 * @param {number} delayMilliseconds - 削除を実行するまでの遅延時間（ミリ秒）。
 */
async function deleteVideoAfterDelay(filePath, delayMilliseconds) {
    console.log(`動画ファイル ${filePath} を ${delayMilliseconds / 1000} 秒後に削除するようスケジュールしました。`);
    // setTimeoutは非同期に指定時間後にコールバックを実行します。
    setTimeout(async () => {
        try {
            // await unlink(filePath) でファイルを非同期に削除します。
            await unlink(filePath);
            console.log(`動画ファイルが削除されました: ${filePath}`);
        } catch (error) {
            // エラーハンドリング
            if (error.code === 'ENOENT') { // 'ENOENT'はファイルやディレクトリが存在しないことを示すエラーコード。
                console.warn(`削除しようとした動画ファイルは既に存在しませんでした: ${filePath}`);
            } else { // その他のエラー（権限問題など）
                console.error(`動画ファイルの削除中にエラーが発生しました: ${filePath}`, error);
            }
        }
    }, delayMilliseconds);
}

/**
 * 動画ファイルの長さを取得する関数。
 * fluent-ffmpegのffprobeを利用して、動画のメタデータから長さを抽出します。
 * @param {string} filePath - 動画ファイルの絶対パス。
 * @returns {Promise<number>} 動画の長さ（秒単位）を解決するPromise。メタデータから取得できない場合は0を解決。
 */
function getVideoDuration(filePath) {
    return new Promise((resolve, reject) => {
        // ffmpeg.ffprobeは、動画ファイルのメタデータを解析する非同期処理です。
        ffmpeg.ffprobe(filePath, (err, metadata) => {
            if (err) {
                console.error(`動画の長さ取得エラー (ffprobe): ${err.message}`);
                return reject(`動画の長さ取得エラー: ${err.message}`); // エラー時はPromiseをreject
            }
            // メタデータオブジェクトのformat.durationプロパティに動画の長さ（秒）が含まれています。
            const durationInSeconds = metadata.format.duration;
            if (durationInSeconds) {
                 console.log(`動画の長さが取得されました: ${durationInSeconds} 秒`);
                 resolve(durationInSeconds); // 長さが取得できたらPromiseをresolve
            } else {
                 console.warn(`動画の長さがメタデータから取得できませんでした: ${filePath}`);
                 resolve(0); // 取得できない場合は0秒として扱う
            }
        });
    });
}

/**
 * yt-dlpを使用してYouTube動画をWebM形式でダウンロードする関数。
 * ダウンロード完了後、動画の長さに応じて自動削除をスケジュールします。
 * @param {string} youtubeUrl - ダウンロード対象のYouTube動画URL。
 * @returns {Promise<string>} ダウンロードされた動画ファイルの絶対パスを解決するPromise。
 */
function downloadVideo(youtubeUrl) {
    return new Promise((resolve, reject) => {
        const fileName = generateRandomFileName() + '.webm'; // ランダムなファイル名生成
        const outputPath = path.join(downloadsDir, fileName); // 出力パス生成

        // yt-dlpコマンド文字列の構築。
        // -f bestvideo[ext=webm]+bestaudio[ext=webm]/bestvideo+bestaudio: WebM形式の最高画質・音質ストリームを選択。
        // --merge-output-format webm: 選択したストリームをWebMコンテナにマージ。
        // --output "${outputPath}": 出力ファイルパス指定。
        const command = `yt-dlp -f bestvideo[ext=webm]+bestaudio[ext=webm]/bestvideo+bestaudio --merge-output-format webm --output "${outputPath}" "${youtubeUrl}"`;
        console.log(`Executing yt-dlp command: ${command}`);

        // execでコマンドを実行。非同期処理。
        exec(command, (error, stdout, stderr) => {
            if (error) {
                console.error(`yt-dlpエラー: ${stderr}`);
                reject(`yt-dlpの実行中にエラーが発生しました: ${stderr}`); // エラー時はPromiseをreject
            } else {
                console.log(`yt-dlp標準出力:\n${stdout}`);
                // コマンド成功後、ファイルが実際に作成されたか確認。
                if (fs.existsSync(outputPath)) {
                     console.log(`動画が正常にダウンロードされました (WebM): ${outputPath}`);

                     // 動画の長さ取得と削除スケジューリング
                     getVideoDuration(outputPath)
                         .then(durationInSeconds => {
                             const maxDelaySeconds = 7200; // 最大削除遅延時間 (2時間)
                             const calculatedDelaySeconds = durationInSeconds * 3; // 動画の長さの3倍
                             // 削除遅延時間は計算値と最大遅延時間の小さい方
                             const finalDelaySeconds = Math.min(calculatedDelaySeconds, maxDelaySeconds);
                             const finalDelayMilliseconds = finalDelaySeconds * 1000;

                             deleteVideoAfterDelay(outputPath, finalDelayMilliseconds); // 削除をスケジュール
                             resolve(outputPath); // ダウンロード成功としてPromiseをresolve
                         })
                         .catch(durationError => {
                             // 長さ取得エラー時もデフォルト時間で削除をスケジュール
                             console.error(`動画の長さ取得エラー発生、デフォルトの削除時間を適用: ${durationError}`);
                             const defaultDelayMilliseconds = 60 * 60 * 1000; // デフォルト1時間
                             deleteVideoAfterDelay(outputPath, defaultDelayMilliseconds);
                             resolve(outputPath); // エラーでもダウンロード自体は成功しているのでresolve
                         });

                } else {
                     // コマンドは成功したがファイルがない場合
                     console.error(`yt-dlpはエラーを報告しませんでしたが、出力ファイルが見つかりません: ${outputPath}`);
                     reject(`yt-dlpは成功しましたが、出力ファイルが見つかりません。`); // Promiseをreject
                }
            }
        });
    });
}

/**
 * 指定されたURLからウェブコンテンツを非同期で取得する汎用関数。
 * HTTPメソッド、ヘッダー、リクエストボディを指定可能。リダイレクトを追跡し、最終URLを返します。
 * 応答データはBufferとして受け取り、文字コード処理は呼び出し元で行います。
 * @param {string} url - 取得対象のURL。
 * @param {string} method - HTTPメソッド (GET, POSTなど)。デフォルトは 'GET'。
 * @param {object} headers - リクエストヘッダーオブジェクト。デフォルトは空オブジェクト。
 * @param {any} data - リクエストボディデータ (POSTなどで使用)。デフォルトはnull。
 * @returns {Promise<{data: Buffer, headers: object, finalUrl: string}>} 応答データ(Buffer)、応答ヘッダー、リダイレクト後の最終URLを含むオブジェクトを解決するPromise。
 */
async function fetchWebPage(url, method = 'GET', headers = {}, data = null) {
    try {
        // axiosリクエストオプションの設定
        const options = {
            method: method,
            url: url,
            responseType: 'arraybuffer', // 応答データをBufferとして取得。これにより、後続で適切な文字コードでデコードできます。
            headers: { // リクエストヘッダーの設定。ブラウザからの一般的なヘッダーを模倣しつつ、引数で指定されたヘッダーをマージ。
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7',
                'Accept-Language': 'ja,en-US;q=0.9,en;q=0.8',
                'Connection': 'keep-alive',
                'Upgrade-Insecure-Requests': '1',
                ...headers, // 渡されたヘッダーでデフォルトをオーバーライドまたは追加
            },
            maxRedirects: 20 // 最大リダイレクト追跡数
        };
        if (data) {
            options.data = data; // リクエストボディの設定
        }

        // axiosによる非同期HTTPリクエスト実行
        const response = await axios(options);
        // リダイレクト後の最終的なURLを取得。response.request.responseURLに格納されます。
        const finalUrl = response.request.responseURL || url;
        if (finalUrl !== url) {
            console.log(`Redirected from ${url} to ${finalUrl}`);
        }
        // 取得したデータ、ヘッダー、最終URLをオブジェクトとして返却
        return { data: response.data, headers: response.headers, finalUrl: finalUrl };
    } catch (error) {
        // エラーハンドリング
        console.error(`ページ取得エラー: ${error.message}`);
        if (error.response) { // サーバーからの応答があった場合（HTTPエラーなど）
            console.error(`ステータスコード: ${error.response.status}`);
            if (error.response.data instanceof Buffer) {
                try {
                    // エラー応答ボディをUTF-8でデコードして表示を試みる
                    console.error(`レスポンスデータ: ${iconv.decode(error.response.data, 'utf-8')}`);
                } catch (e) {
                    // デコード失敗時は16進数で表示
                    console.error(`レスポンスデータ (デコード失敗): ${error.response.data.toString('hex')}`);
                }
            } else {
                 console.error(`レスポンスデータ: ${error.response.data}`);
            }
            console.error(`レスポンスヘッダー: ${JSON.stringify(error.response.headers)}`);
        } else if (error.request) { // リクエストは送信されたが応答がなかった場合
            console.error('リクエストは行われませんでしたが、応答がありませんでした');
            console.error(error.request);
        } else { // リクエスト設定自体に問題があった場合
            console.error('リクエストの設定中にエラーが発生しました');
        }
        throw new Error(`ページ取得エラー: ${error.message}`); // エラーを再スローして呼び出し元に伝播
    }
}

/**
 * Buffer形式のコンテンツを指定されたヘッダー情報に基づいて適切な文字コードで文字列にデコードする関数。
 * Content-TypeヘッダーやHTML内のmetaタグからエンコーディングを推測します。
 * @param {Buffer} buffer - デコード対象のBufferデータ。
 * @param {object} headers - 応答ヘッダーオブジェクト。エンコーディング情報が含まれる可能性がある。
 * @returns {string} デコードされた文字列。デコード失敗時はUTF-8フォールバックを試みる。
 */
function decodeContent(buffer, headers) {
    let encoding = 'utf-8'; // デフォルトエンコーディング

    // 1. Content-Typeヘッダーからのエンコーディング検出
    const contentType = headers['content-type'];
    if (contentType) {
        const charsetMatch = contentType.match(/charset=([^;]+)/i); // charset=... を抽出
        if (charsetMatch && charsetMatch[1]) {
            const determinedEncoding = charsetMatch[1].toLowerCase();
            if (iconv.encodingExists(determinedEncoding)) { // iconv-liteがサポートしているか確認
                encoding = determinedEncoding;
                console.log(`Detected encoding from Content-Type: ${encoding}`);
            } else {
                console.warn(`Unsupported encoding from Content-Type: ${determinedEncoding}, falling back to ${encoding}`);
            }
        }
    }

    // 2. Content-Typeがtext/htmlの場合、HTML内のmetaタグからのエンコーディング検出
    // Content-Typeヘッダーよりもmetaタグの方が優先される場合があります。
    if (contentType && contentType.includes('text/html')) {
        try {
            // HTMLの最初のチャンク（エンコーディング情報が含まれる可能性が高い部分）をUTF-8で仮デコード。
            // fatal: falseは、仮デコード時の文字化けエラーを無視する設定です。
            const tempHtml = iconv.decode(buffer.slice(0, 4096), 'utf-8', { fatal: false, specialChars: true });
            // <meta charset="..."> または <meta http-equiv="Content-Type" content="...; charset=..."> を正規表現で検索。
            const charsetMetaMatch = tempHtml.match(/<meta\s+[^>]*charset=["']?([^"' >]+)["']?/i);
            if (charsetMetaMatch && charsetMetaMatch[1]) {
                const determinedEncoding = charsetMetaMatch[1].toLowerCase();
                 if (iconv.encodingExists(determinedEncoding)) {
                    encoding = determinedEncoding; // metaタグで検出されたエンコーディングを優先
                    console.log(`Detected encoding from meta tag: ${encoding}`);
                } else {
                    console.warn(`Unsupported encoding from meta tag: ${determinedEncoding}, falling back to ${encoding}`);
                }
            }
        } catch (e) {
            console.error("Error detecting encoding from meta tag:", e);
        }
    }

    // 3. 最終的に決定したエンコーディングでBufferをデコード
    try {
        return iconv.decode(buffer, encoding);
    } catch (e) {
        // 決定したエンコーディングでのデコードに失敗した場合、UTF-8でフォールバックを試みる
        console.error(`Failed to decode with ${encoding}, attempting utf-8:`, e);
        try {
             // UTF-8でのデコード（エラーを致命的としない設定）
             return iconv.decode(buffer, 'utf-8', { fatal: false, specialChars: true });
        } catch (e2) {
             // UTF-8でも失敗した場合
             console.error("Failed to decode with utf-8:", e2);
             // 最終手段としてBufferのtoString('utf-8')を使用（完全なデコードを保証しないが、何らかの文字列を得るため）
             return buffer.toString('utf-8');
        }
    }
}


/**
 * HTMLコンテンツ内のURL（リンク、画像、スクリプト、CSSなど）およびフォームのaction属性を、
 * このプロキシサーバーを経由するように書き換える関数。
 * 元のURLはBase64エンコードされ、プロキシURLのクエリパラメータとして埋め込まれます。
 * これにより、クライアントが書き換えられたURLにアクセスした際に、プロキシが元のURLを特定してコンテンツを取得できます。
 * @param {string} html - 書き換え対象のHTMLコンテンツ文字列。
 * @param {string} baseUrl - 元のHTMLコンテンツが取得されたページの最終的なURL。相対URLの絶対URLへの解決に使用。
 * @returns {string} URLが書き換えられたHTMLコンテンツ文字列。
 */
function rewriteUrls(html, baseUrl) {
    const $ = cheerio.load(html); // CheerioでHTMLをパースし、DOM操作可能なオブジェクトを取得。

    // URLを含む可能性のあるHTML要素とその属性のマッピング。
    const elementsWithUrls = {
        'a': 'href', // <a> タグの href 属性
        'link': 'href', // <link> タグの href 属性 (CSS, faviconなど)
        'img': 'src', // <img> タグの src 属性
        'script': 'src', // <script> タグの src 属性
        'iframe': 'src', // <iframe> タグの src 属性
        'source': 'src', // <video>, <audio> タグ内の <source> タグの src 属性
        'video': 'src', // <video> タグ自体の src 属性
        'audio': 'src', // <audio> タグ自体の src 属性
        'track': 'src', // <track> タグの src 属性 (字幕など)
    };

    // 各要素タイプに対してURL書き換え処理を実行。
    Object.keys(elementsWithUrls).forEach(selector => {
        const attribute = elementsWithUrls[selector];
        $(selector).each((index, element) => {
            const $element = $(element);
            let originalUrl = $element.attr(attribute); // 元の属性値を取得。

            // URLが存在し、データURL (data:) やページ内リンク (#) でない場合のみ処理。
            if (originalUrl && !originalUrl.startsWith('data:') && !originalUrl.startsWith('#')) {
                try {
                    // 相対URLをbaseUrlを基準に絶対URLに解決。
                    const resolvedUrl = urlModule.resolve(baseUrl, originalUrl);
                    // プロキシ経由の新しいURLを作成。形式は '/proxy?url=<Base64エンコードされた絶対URL>'。
                    // Base64エンコードは、URLに含まれる特殊文字がクエリパラメータを壊さないようにするためと、元のURLを直接表示させないため。
                    const proxiedUrl = `/proxy?url=${Buffer.from(resolvedUrl).toString('base64')}`;
                    $element.attr(attribute, proxiedUrl); // 要素の属性値を書き換え。
                } catch (e) {
                    console.error(`URLの書き換え中にエラーが発生しました: ${originalUrl} (Base: ${baseUrl})`, e);
                }
            }
        });
    });

    // <form> タグの action 属性の書き換え。
    // フォーム送信もプロキシを経由するようにします。元の送信先URLとメソッドは隠しフィールドとして埋め込みます。
    $('form').each((index, element) => {
        const $element = $(element);
        let originalAction = $element.attr('action');
        const method = $element.attr('method') || 'GET'; // デフォルトメソッドはGET。

        // action属性が存在し、データURLでない場合。
        if (originalAction && !originalAction.startsWith('data:')) {
             try {
                // actionのURLをbaseUrlを基準に絶対URLに解決。
                const resolvedActionUrl = urlModule.resolve(baseUrl, originalAction);
                $element.attr('action', '/proxy'); // action属性をプロキシのエンドポイントに書き換え。
                $element.attr('method', 'POST'); // プロキシでデータを受け取るため、メソッドをPOSTに強制。
                // 元のターゲットURLとメソッドをBase64エンコードして隠しフィールドとしてフォームに追加。
                $element.append(`<input type="hidden" name="__proxy_target_url" value="${Buffer.from(resolvedActionUrl).toString('base64')}">`);
                $element.append(`<input type="hidden" name="__proxy_target_method" value="${method.toUpperCase()}">`);
             } catch (e) {
                 console.error(`Form Actionの書き換え中にエラーが発生しました: ${originalAction} (Base: ${baseUrl})`, e);
             }
        } else if (!originalAction) {
             // action属性が指定されていない場合（通常は現在のページへのPOSTとみなされる）。
             const resolvedActionUrl = baseUrl; // ベースURLをターゲットとする。
             $element.attr('action', '/proxy'); // action属性をプロキシのエンドポイントに書き換え。
             $element.attr('method', 'POST'); // メソッドをPOSTに強制。
             // 元のターゲットURL（ベースURL）とメソッドを隠しフィールドとして追加。
             $element.append(`<input type="hidden" name="__proxy_target_url" value="${Buffer.from(resolvedActionUrl).toString('base64')}">`);
             $element.append(`<input type="hidden" name="__proxy_target_method" value="${method.toUpperCase()}">`);
        }
    });

    // <base> タグの削除。
    // <base>タグは相対URLの解決基準を指定しますが、プロキシがURLを書き換えるため、元のbaseタグがあると予期しない動作を引き起こす可能性があります。
    $('base').remove();

    // <style> タグ（インラインCSS）内の url() の書き換え。
    $('style').each((index, element) => {
        const $element = $(element);
        let styleContent = $element.html(); // styleタグ内のCSSコンテンツを取得。
        if (styleContent) {
            // CSS内の url(...) または url('...') または url("...") を正規表現で検索・置換。
            styleContent = styleContent.replace(/url\(['"]?(.*?)['"]?\)/g, (match, url) => {
                // URLが存在し、データURLでない場合のみ処理。
                if (url && !url.startsWith('data:')) {
                    try {
                        // CSS内のURLをbaseUrlを基準に絶対URLに解決。
                        const resolvedUrl = urlModule.resolve(baseUrl, url);
                        // プロキシ経由のURLを作成。
                        const proxiedUrl = `/proxy?url=${Buffer.from(resolvedUrl).toString('base64')}`;
                        return `url('${proxiedUrl}')`; // 書き換えたプロキシURLを含むurl()形式の文字列を返す。
                    } catch (e) {
                         console.error(`Style URLの書き換え中にエラーが発生しました: ${url} (Base: ${baseUrl})`, e);
                         return match; // エラー時は元の文字列をそのまま返す。
                    }
                }
                return match; // データURLなどの場合は元の文字列をそのまま返す。
            });
            $element.html(styleContent); // 書き換えたCSSコンテンツでstyleタグの内容を更新。
        }
    });

    return $.html(); // 書き換え後のHTMLコンテンツ全体を文字列として返す。
}

/**
 * 外部CSSコンテンツ内の url() をプロキシ経由に書き換える関数。
 * rewriteUrls内のstyleタグ処理と同様のロジックですが、CSSファイル全体を対象とします。
 * @param {string} css - 書き換え対象のCSSコンテンツ文字列。
 * @param {string} baseUrl - 元のCSSコンテンツを読み込んだページの最終的なURL。相対URLの絶対URLへの解決に使用。
 * @returns {string} URLが書き換えられたCSSコンテンツ文字列。
 */
function rewriteCssUrls(css, baseUrl) {
    // CSS内の url(...) または url('...') または url("...") を正規表現で検索・置換。
    const rewrittenCss = css.replace(/url\(['"]?(.*?)['"]?\)/g, (match, url) => {
        // URLが存在し、データURLでない場合のみ処理。
        if (url && !url.startsWith('data:')) {
            try {
                // CSS内のURLをbaseUrlを基準に絶対URLに解決。
                const resolvedUrl = urlModule.resolve(baseUrl, url);
                // プロキシ経由のURLを作成。
                const proxiedUrl = `/proxy?url=${Buffer.from(resolvedUrl).toString('base64')}`;
                return `url('${proxiedUrl}')`; // 書き換えたプロキシURLを含むurl()形式の文字列を返す。
            } catch (e) {
                 console.error(`CSS URLの書き換え中にエラーが発生しました: ${url} (Base: ${baseUrl})`, e);
                 return match; // エラー時は元の文字列をそのまま返す。
            }
        }
        return match; // データURLなどの場合は元の文字列をそのまま返す。
    });
    return rewrittenCss; // 書き換え後のCSSコンテンツを文字列として返す。
}

// 認証済みユーザーのみアクセスを許可するミドルウェア。
// セッションにauthenticatedフラグがtrueで設定されているか確認します。
function isAuthenticated(req, res, next) {
    // セッションが存在し、かつauthenticatedプロパティがtrueの場合
    if (req.session && req.session.authenticated) {
        return next(); // 次のミドルウェアまたはルートハンドラへ処理を渡す。
    } else {
        res.redirect('/login'); // 認証されていない場合はログインページへリダイレクト。
    }
}

// ログインページのGETリクエストハンドラ。
// ログインフォームを含むHTMLをクライアントに送信します。
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
                ${req.query.error ? `<p class="error">${req.query.error}</p>` : ''}
            </div>
        </body>
        </html>
    `);
});

// ログイン処理のPOSTリクエストハンドラ。
// フォームから送信されたパスワードを検証し、一致すればセッションに認証済みフラグを設定します。
app.post('/login', (req, res) => {
    const password = req.body.password; // リクエストボディからパスワードを取得。

    if (password === SECRET_PASSWORD) { // パスワードの一致確認。
        req.session.authenticated = true; // セッションに認証済みフラグを設定。
        res.redirect('/'); // 認証成功時はルートパスへリダイレクト。
    } else {
        // パスワード不一致時はエラーメッセージ付きでログインページへリダイレクト。
        res.redirect('/login?error=' + encodeURIComponent('パスワードが間違っています。'));
    }
});

// ログアウト処理のGETリクエストハンドラ。
// セッションを破棄し、認証済み状態を解除します。
app.get('/logout', (req, res) => {
    req.session.destroy((err) => { // セッションの破棄。
        if (err) {
            console.error("セッション破棄エラー:", err);
            res.status(500).send("ログアウトに失敗しました。");
        } else {
            res.redirect('/login'); // ログアウト成功時はログインページへリダイレクト。
        }
    });
});

// ルートパス ('/') のGETリクエストハンドラ。
// isAuthenticatedミドルウェアにより認証済みユーザーのみアクセス可能。
// プロキシ利用のためのURL入力フォームを含むページを表示します。
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
                 <a href="/logout" class="logout-link">ログアウト</a>
                 <h1>プロキシ経由でコンテンツにアクセス</h1>
                <form action="/proxy" method="post"> // フォーム送信先はプロキシエンドポイント '/proxy'。
                    <input type="text" name="url" placeholder="URLを入力 (例: https://www.google.com)" required>
                    <button type="submit">アクセス</button>
                </form>
                <p>注意: 動画のストリーミングには少し時間がかかる場合があります。</p>
                 ${req.query.error ? `<p class="error">${req.query.error}</p>` : ''}
            </div>
        </body>
        </html>
    `);
});


// プロキシ処理のPOSTリクエストハンドラ。
// フォーム送信（特に書き換えられたフォーム）によるリクエストを処理します。
app.post('/proxy', isAuthenticated, async (req, res) => {
    let targetUrl = req.body.url; // 入力フォームからのURL取得（初期値）
    let targetMethod = 'GET'; // 外部サイトへのリクエストメソッド（デフォルト）
    let requestBody = req.body; // リクエストボディ全体
    let isFormSubmission = false; // 書き換えられたフォームからの送信フラグ

    // 書き換えられたフォームからの送信かを判定。隠しフィールド '__proxy_target_url' の存在で判断。
    if (requestBody && requestBody.__proxy_target_url) {
        isFormSubmission = true;
        try {
            // Base64エンコードされた元のターゲットURLとメソッドをデコード。
            targetUrl = Buffer.from(requestBody.__proxy_target_url, 'base64').toString('utf-8');
            targetMethod = requestBody.__proxy_target_method || 'GET';
            console.log(`Received proxied form submission to: ${targetUrl} with method ${targetMethod}`);

            // プロキシ処理用の隠しフィールドは不要になったため削除。
            delete requestBody.__proxy_target_url;
            delete requestBody.__proxy_target_method;

        } catch (e) {
            console.error("Failed to decode proxy target URL or method from form data:", e);
            return res.status(400).send('Invalid proxy target information.'); // 不正なデータの場合はエラー応答。
        }
    } else if (!targetUrl) {
        // フォーム送信ではなく、かつURLが指定されていない場合はエラー。
        console.error("URLが指定されていません (POST)");
        return res.redirect('/?error=' + encodeURIComponent('URLを指定してください。'));
    } else {
         // トップページの入力フォームからの送信など、隠しフィールドがない場合。
         try {
              // 受け取ったURLがBase64エンコードされている可能性を考慮しデコードを試みる。
              const decodedUrl = Buffer.from(targetUrl, 'base64').toString('utf-8');
              if (decodedUrl && (decodedUrl.startsWith('http://') || decodedUrl.startsWith('https://'))) {
                  targetUrl = decodedUrl; // 有効な絶対URLであれば採用。
                  console.log(`Received Base64 encoded URL (initial), decoded to: ${targetUrl}`);
              } else {
                  console.log(`Received non-Base64 or invalid URL (initial): ${targetUrl}`);
              }
          } catch (e) {
              console.error(`Base64 decoding failed (initial), using original URL: ${targetUrl}`, e);
          }

          // URLが絶対URLでない場合、プロキシのベースURLを基準に解決を試みる。
          if (!targetUrl.startsWith('http://') && !targetUrl.startsWith('https://')) {
               try {
                   const proxyBaseUrl = `${req.protocol}://${req.get('host')}/`; // プロキシサーバーのベースURLを取得。
                   const resolvedInitialUrl = urlModule.resolve(proxyBaseUrl, targetUrl); // 相対URLを解決。

                   if (resolvedInitialUrl.startsWith('http://') || resolvedInitialUrl.startsWith('https://')) {
                       targetUrl = resolvedInitialUrl; // 解決後の有効な絶対URLを採用。
                       console.log(`Resolved initial input relative URL: ${targetUrl}`);
                   } else {
                       console.error(`Invalid initial input URL after resolution: ${resolvedInitialUrl}`);
                       return res.redirect('/?error=' + encodeURIComponent('無効なURL形式です。フルURLを入力してください。')); // 解決後も無効ならエラー。
                   }
               } catch (e) {
                   console.error(`Error resolving initial input URL: ${targetUrl}`, e);
                   return res.redirect('/?error=' + encodeURIComponent('URLの解決中にエラーが発生しました。'));
               }
          }

          targetMethod = 'GET'; // このケースでは外部サイトへのリクエストはGETとする。
          requestBody = null; // リクエストボディはなし。
    }

    // クライアントからのリクエストヘッダーを取得。外部サイトへのリクエストヘッダー構築に使用。
    const userAgent = req.headers['user-agent'];
    const referer = req.headers['referer'];

    // 外部サイトへのリクエストヘッダーを構築。クライアントからのヘッダーをコピーしつつ、一部を調整。
    const requestHeaders = {
        'Accept': req.headers['accept'] || 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7',
        'Accept-Language': req.headers['accept-language'] || 'ja,en-US;q=0.9,en;q=0.8',
        'User-Agent': userAgent || 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36', // User-Agentを設定（クライアントからなければデフォルト）
        'Connection': 'keep-alive',
        'Upgrade-Insecure-Requests': '1',
        ...(referer && { 'Referer': referer }), // Refererヘッダーは存在する場合のみ追加。
         // クライアントからのヘッダーをほぼ全てコピーするが、プロキシとして自分で設定するヘッダー（host, cookieなど）は除く。
         ...Object.keys(req.headers).reduce((acc, headerName) => {
             if (!['host', 'cookie', 'content-type', 'content-length', 'connection', 'user-agent', 'referer', 'accept', 'accept-language', 'upgrade-insecure-requests'].includes(headerName.toLowerCase())) {
                  acc[headerName] = req.headers[headerName];
             }
             return acc;
         }, {})
    };

    // POSTリクエストの場合、Content-Typeヘッダーとリクエストボディを設定。
    if (targetMethod === 'POST' && requestBody) {
        requestHeaders['Content-Type'] = 'application/x-www-form-urlencoded';
        if (typeof requestBody !== 'string') {
             requestBody = qs.stringify(requestBody); // オブジェクト形式のリクエストボディをURLエンコードされた文字列に変換。
        }
    }

    try {
        // YouTube動画URLかどうかの判定正規表現。
        const youtubeRegex = /^(https?:\/\/)?(www\.)?(youtube\.com|youtu\.be)\/.+$/;

        // GETリクエストで、フォーム送信ではなく、かつYouTube URLの場合、動画ダウンロード処理へ。
        if (targetMethod === 'GET' && !isFormSubmission && youtubeRegex.test(targetUrl)) {
             console.log(`YouTube動画のURLが指定されました: ${targetUrl}`);
             const videoPath = await downloadVideo(targetUrl); // 動画ダウンロード実行。
             const videoFileName = path.basename(videoPath); // ダウンロードしたファイル名を取得。
             // プロキシサーバー上の動画ファイルへの直接アクセスURLを生成。
             const videoUrl = `${req.protocol}://${req.get('host')}/video/${videoFileName}`;
             console.log(`動画ファイルへの直接URL: ${videoUrl}`);
             res.redirect(videoUrl); // 生成したURLへリダイレクト。これによりブラウザが動画ファイルに直接アクセスしストリーミング再生を開始します。

        } else {
            // YouTube動画でない、またはPOSTリクエストの場合、通常のウェブページ取得処理へ。
            console.log(`ターゲットURLにアクセスします (${targetMethod}): ${targetUrl}`);
            // fetchWebPage関数で外部サイトのコンテンツを取得。
            const { data: pageContentBuffer, headers, finalUrl } = await fetchWebPage(targetUrl, targetMethod, requestHeaders, requestBody);
            const contentType = headers['content-type']; // 応答のContent-Typeを取得。

            // 取得したコンテンツタイプに応じた処理。
            if (contentType && contentType.includes('text/html')) {
                 // HTMLの場合: デコード、URL書き換え、セッションへの最終URL保存。
                 const pageContent = decodeContent(pageContentBuffer, headers);
                 const rewrittenHtml = rewriteUrls(pageContent, finalUrl);
                 req.session.lastProxiedUrl = finalUrl; // 相対URL解決のために最終URLをセッションに保存。
                 console.log(`Saved last proxied URL to session: ${finalUrl}`);
                 res.setHeader('Content-Type', 'text/html; charset=utf-8'); // 応答ヘッダー設定。
                 res.send(rewrittenHtml); // 書き換えたHTMLを送信。
            } else if (contentType && contentType.includes('text/css')) {
                 // CSSの場合: デコード、URL書き換え。
                 const pageContent = decodeContent(pageContentBuffer, headers);
                 const rewrittenCss = rewriteCssUrls(pageContent, finalUrl);
                 res.setHeader('Content-Type', 'text/css; charset=utf-8'); // 応答ヘッダー設定。
                 res.send(rewrittenCss); // 書き換えたCSSを送信。
            } else {
                // その他のコンテンツタイプ（画像、動画など）の場合: ヘッダーを調整してBufferをそのまま送信。
                for (const header in headers) {
                     if (header.toLowerCase() === 'content-type') {
                         // Content-Typeからcharset情報を削除し、テキストの場合はutf-8を追加。
                         const cleanContentType = contentType.replace(/;\s*charset=[^;]+/i, '');
                         if (cleanContentType.startsWith('text/')) {
                              res.setHeader('Content-Type', cleanContentType + '; charset=utf-8');
                         } else {
                              res.setHeader('Content-Type', cleanContentType);
                         }
                     } else if (header.toLowerCase() !== 'content-encoding' && header.toLowerCase() !== 'content-length') {
                         // Content-EncodingとContent-Lengthはプロキシが制御するためコピーしない。
                         res.setHeader(header, headers[header]); // その他のヘッダーはコピー。
                     }
                }
                res.send(pageContentBuffer); // 取得したBufferデータをそのままクライアントに送信。
            }
        }
    } catch (error) {
        console.error(`処理中にエラーが発生しました (POST): ${error.message}`);
        res.redirect('/?error=' + encodeURIComponent(`処理に失敗しました: ${error.message}`)); // エラー時はトップページへリダイレクトしエラー表示。
    }
});

// プロキシ処理のGETリクエストハンドラ。
// 主にrewriteUrls関数によって書き換えられたURL（例: /proxy?url=...）からのリクエストを処理します。
app.get('/proxy', isAuthenticated, async (req, res) => {
    let targetUrl = req.query.url; // クエリパラメータからBase64エンコードされたターゲットURLを取得。
    const refererUrl = req.headers['referer']; // Refererヘッダーを取得。

    // ターゲットURLがクエリパラメータで指定されていない場合。
    // これは、HTML内の相対パス（例: <img src="/images/logo.png">）がプロキシ経由でリクエストされたケースが考えられます。
    if (!targetUrl) {
        const requestedPath = req.path; // リクエストされたパス（例: /proxy/images/logo.png）を取得。
        const lastProxiedUrl = req.session.lastProxiedUrl; // セッションに保存しておいた、最後にプロキシしたページのURLを取得。

        // 最後にプロキシしたページのURLがセッションにあり、かつリクエストパスがルートでない場合。
        if (lastProxiedUrl && requestedPath !== '/') {
            console.warn(`Caught potential direct relative path access: ${requestedPath}. Attempting to resolve against last proxied URL: ${lastProxiedUrl}`);
            try {
                // リクエストされた相対パスを、最後にプロキシしたページのURLを基準に絶対URLに解決。
                const resolvedUrl = urlModule.resolve(lastProxiedUrl, requestedPath);
                // 解決した絶対URLを使って、正しいプロキシ経由のURL（/proxy?url=Base64...）を作成。
                const correctProxiedUrl = `/proxy?url=${Buffer.from(resolvedUrl).toString('base64')}`;
                console.log(`Redirecting to correct proxied URL: ${correctProxiedUrl}`);
                return res.redirect(correctProxiedUrl); // 正しいプロキシURLへリダイレクト。
            } catch (e) {
                console.error(`Error resolving relative path ${requestedPath} against ${lastProxiedUrl}:`, e);
                return res.status(500).send(`Error resolving relative path.`); // 解決エラー時はサーバーエラー応答。
            }
        } else {
            console.error("URLが指定されていません (GET) and no last proxied URL in session.");
            return res.status(400).send('URLを指定してください。またはセッション情報がありません。'); // URL指定なし、かつセッション情報もない場合はエラー応答。
        }
    }

    try {
         // クエリパラメータから取得したターゲットURL（Base64エンコードされているはず）をデコード。
         const decodedUrl = Buffer.from(targetUrl, 'base64').toString('utf-8');
         if (decodedUrl && (decodedUrl.startsWith('http://') || decodedUrl.startsWith('https://'))) {
             targetUrl = decodedUrl; // 有効な絶対URLであれば採用。
             console.log(`Received Base64 encoded URL, decoded to: ${targetUrl}`);
         } else {
             console.log(`Received non-Base64 or invalid URL: ${targetUrl}`);
         }
     } catch (e) {
         console.error(`Base64 decoding failed, using original URL: ${targetUrl}`, e);
     }

    // クライアントからのリクエストヘッダーを取得。
    const userAgent = req.headers['user-agent'];

    // 外部サイトへのリクエストヘッダーを構築。GETリクエストの場合、Acceptヘッダーのデフォルト値が異なります。
    const requestHeaders = {
        'Accept': req.headers['accept'] || '*/*', // GETリクエストではAccept: */* をデフォルトとする。
        'Accept-Language': req.headers['accept-language'] || 'ja,en-US;q=0.9,en;q=0.8',
        'User-Agent': userAgent || 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
        'Connection': 'keep-alive',
        ...(refererUrl && { 'Referer': refererUrl }), // Refererヘッダーがあれば追加。
         // Sec-Fetch関連ヘッダーもコピー。
         ...(req.headers['sec-fetch-site'] && { 'Sec-Fetch-Site': req.headers['sec-fetch-site'] }),
         ...(req.headers['sec-fetch-mode'] && { 'Sec-Fetch-Mode': req.headers['sec-fetch-mode'] }),
         ...(req.headers['sec-fetch-dest'] && { 'Sec-Fetch-Dest': req.headers['sec-fetch-dest'] }),
         ...(req.headers['sec-fetch-user'] && { 'Sec-Fetch-User': req.headers['sec-fetch-user'] }),
         // その他のヘッダーをコピー（一部除く）。
         ...Object.keys(req.headers).reduce((acc, headerName) => {
             if (!['host', 'cookie', 'content-type', 'content-length', 'connection', 'user-agent', 'referer', 'accept', 'accept-language', 'upgrade-insecure-requests', 'sec-fetch-site', 'sec-fetch-mode', 'sec-fetch-dest', 'sec-fetch-user'].includes(headerName.toLowerCase())) {
                  acc[headerName] = req.headers[headerName];
             }
             return acc;
         }, {})
    };

    try {
        console.log(`一般的なURLにアクセスします (GET): ${targetUrl}`);
        // fetchWebPage関数で外部サイトのコンテンツを取得（メソッドはGET固定）。
        const { data: pageContentBuffer, headers, finalUrl } = await fetchWebPage(targetUrl, 'GET', requestHeaders);
        const contentType = headers['content-type']; // 応答のContent-Typeを取得。

        // 取得したコンテンツタイプに応じた処理。
        if (contentType && contentType.includes('text/html')) {
            // HTMLの場合: デコード、URL書き換え、セッションへの最終URL保存。
            const pageContent = decodeContent(pageContentBuffer, headers);
            const rewrittenHtml = rewriteUrls(pageContent, finalUrl);
            req.session.lastProxiedUrl = finalUrl; // 相対URL解決のために最終URLをセッションに保存。
            console.log(`Saved last proxied URL to session: ${finalUrl}`);
            res.setHeader('Content-Type', 'text/html; charset=utf-8'); // 応答ヘッダー設定。
            res.send(rewrittenHtml); // 書き換えたHTMLを送信。
        } else if (contentType && contentType.includes('text/css')) {
            // CSSの場合: デコード、URL書き換え。
            const pageContent = decodeContent(pageContentBuffer, headers);
            const rewrittenCss = rewriteCssUrls(pageContent, finalUrl);
            res.setHeader('Content-Type', 'text/css; charset=utf-8'); // 応答ヘッダー設定。
            res.send(rewrittenCss); // 書き換えたCSSを送信。
        } else {
            // その他のコンテンツタイプの場合: ヘッダーを調整してBufferをそのまま送信。
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
            res.send(pageContentBuffer); // 取得したBufferデータをそのままクライアントに送信。
        }

    } catch (error) {
        console.error(`処理中にエラーが発生しました (GET): ${error.message}`);
        res.status(500).send(`処理に失敗しました: ${error.message}`); // エラー時はサーバーエラー応答。
    }
});


// '/video/:fileName' というアドレスへのGETリクエストハンドラ。
// isAuthenticatedミドルウェアにより認証済みユーザーのみアクセス可能。
// ダウンロードフォルダ内の動画ファイルをストリーミング配信します。Rangeヘッダーに対応し、シーク再生を可能にします。
app.get('/video/:fileName', isAuthenticated, (req, res) => {
    const fileName = req.params.fileName; // URLパラメータからファイル名を取得。
    const filePath = path.join(downloadsDir, fileName); // ファイルの絶対パスを生成。

    // ファイルの情報を取得（存在確認、サイズなど）。
    fs.stat(filePath, (err, stat) => {
        if (err) {
            console.error(`動画ファイルが見つからないか、アクセスできません: ${filePath}`, err);
            return res.status(404).send("動画ファイルが見つかりません"); // ファイルが見つからない場合は404エラー。
        }

        const fileSize = stat.size; // ファイルサイズ。
        const range = req.headers.range; // Rangeヘッダーを取得（シーク再生リクエストの場合に存在する）。

        if (range) {
            // Rangeリクエストの場合（部分的なコンテンツ要求）。
            const parts = range.replace(/bytes=/, "").split("-");
            const start = parseInt(parts[0], 10); // 開始バイト位置。
            const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1; // 終了バイト位置（指定がなければ最後まで）。
            const chunkSize = (end - start) + 1; // 送信するデータのサイズ。

            // 指定された範囲のファイルを読み込むためのリードストリームを作成。
            const fileStream = fs.createReadStream(filePath, { start, end });

            // HTTP応答ヘッダーを設定。ステータスコードは206 Partial Content。
            res.writeHead(206, {
                "Content-Range": `bytes ${start}-${end}/${fileSize}`, // 応答するデータの範囲とファイルサイズ全体。
                "Accept-Ranges": "bytes", // バイト単位での範囲要求を受け付け可能であることを示す。
                "Content-Length": chunkSize, // 応答するデータのサイズ。
                "Content-Type": "video/webm", // コンテンツタイプ。
            });

            // ファイルストリームから読み込んだデータを応答ストリームへパイプ（ストリーミング）。
            fileStream.pipe(res);

            // ストリーム終了時の処理。
            fileStream.on('end', () => {
                console.log('Range stream finished');
                res.end(); // 応答を終了。
            });

            // ストリームエラー時の処理。
            fileStream.on('error', (streamErr) => {
                console.error(`ファイルストリームエラー: ${streamErr.message}`);
                res.sendStatus(500); // サーバーエラー応答。
            });

        } else {
            // Rangeリクエストでない場合（ファイル全体要求）。
            const stream = fs.createReadStream(filePath); // ファイル全体を読み込むリードストリームを作成。
            // HTTP応答ヘッダーを設定。ステータスコードは200 OK。
            res.writeHead(200, {
                "Content-Length": fileSize, // ファイルサイズ全体。
                "Content-Type": "video/webm", // コンテンツタイプ。
                "Accept-Ranges": "bytes", // バイト単位での範囲要求を受け付け可能であることを示す（今後のRangeリクエストに備える）。
            });

            // ファイルストリームから読み込んだデータを応答ストリームへパイプ（ストリーミング）。
            stream.pipe(res);

            // ストリーム終了時の処理。
            stream.on('end', () => {
                console.log('Full stream finished');
                res.end(); // 応答を終了。
            });

            // ストリームエラー時の処理。
            stream.on('error', (streamErr) => {
                console.error(`Stream error: ${streamErr.message}`);
                res.sendStatus(500); // サーバーエラー応答。
            });
        }
    });
});


// サーバーの起動。
// 指定したポートでHTTPリクエストのリッスンを開始します。
app.listen(port, () => {
    console.log(`Proxy server running at http://localhost:${port}/`);
    console.log(`Downloads will be saved in: ${downloadsDir}`);
    console.log(`Access the login page at http://localhost:${port}/login`);
});

// アプリケーション終了時のクリーンアップ処理（コメントアウトされています）。
// サーバー停止時にダウンロードフォルダ内のファイルを削除する処理を実装できますが、
// 現在はコメントアウトされており、有効になっていません。
// process.on('exit', cleanup); // プロセス終了イベントでcleanupを実行。
// process.on('SIGINT', cleanup); // SIGINTシグナル（Ctrl+Cなど）受信時にcleanupを実行。

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
