// ここからNode.jsというプログラム実行環境で使う「部品（モジュール）」を読み込んでいます。
// これらの部品を使うことで、ウェブサーバーを作ったり、ファイルを扱ったり、他のウェブサイトから情報を取ってきたりできます。
const express = require('express'); // ウェブサイトを作るための「Express」という便利な部品
const axios = require('axios'); // 他のウェブサイトに「これちょうだい」とお願い（HTTPリクエスト）するための部品
const cheerio = require('cheerio'); // ウェブサイトのHTML（見た目を作る設計図）を簡単に操作するための部品（jQueryに似ています）
const cookieParser = require('cookie-parser'); // ウェブサイトが一時的に情報を保存する「クッキー」を読み取るための部品
const session = require('express-session'); // ユーザーごとに異なる情報を覚えておく「セッション」を管理するための部品
const { exec } = require('child_process'); // パソコンの中で別のプログラム（このコードの場合は「yt-dlp」）を動かすための部品
const fs = require('fs'); // パソコンの中のファイルやフォルダを操作するための部品（ファイルの読み書き、作成など）
const path = require('path'); // ファイルやフォルダの場所（パス）を扱いやすくするための部品
const crypto = require('crypto'); // 暗号化など、安全に情報を扱うための部品（ここではランダムな名前を作るのに使います）
const { promisify } = require('util'); // コールバック形式の関数（処理が終わったら教えてね、という形式）を、async/awaitで使いやすいPromise形式に変える部品
const { unlink } = require('fs').promises; // ファイルを削除するためのfs部品の「unlink」関数を、Promiseとして使えるようにしたもの
const ffmpeg = require('fluent-ffmpeg'); // 動画や音声のファイルを処理するための部品（ここでは動画の長さを調べます）
const urlModule = require('url'); // ウェブサイトのアドレス（URL）を解析したり、組み立てたりするための部品
const iconv = require('iconv-lite'); // いろいろな国の文字の表示（エンコーディング）を正しく扱うための部品
const qs = require('qs'); // ウェブサイトのアドレスの後ろにつく「?key=value&key2=value2」のような情報（クエリ文字列）を扱いやすくするための部品

// Expressアプリケーション（これがウェブサーバーの本体になります）を作成します
const app = express();
const port = 3000; // このサーバーをパソコンの「3000番ポート」で起動します。ウェブブラウザで「http://localhost:3000/」と入力するとアクセスできるようになります。

// 認証（ログイン）のための設定です
const SECRET_PASSWORD = '56562'; // ログインに必要なパスワードです。★★★重要★★★：このパスワードは誰にも知られないように、もっと複雑なものに変えましょう！そして、コードの中に直接書かずに、安全な場所に保管するのが普通です。
const SESSION_SECRET = 'ugud6fddtd77785rthytyujh'; // セッション情報を安全に保つための秘密の鍵です。これも推測されにくいランダムな文字列に変えましょう！

// ダウンロードしたファイルを保存するフォルダの場所を決めます
const downloadsDir = path.join(__dirname, 'downloads'); // このserver.jsファイルがある場所（__dirname）の中に、「downloads」という名前のフォルダを作ります

// ダウンロードフォルダが存在するか確認し、なければ作成します
if (!fs.existsSync(downloadsDir)){ // downloadsDirで指定した場所にフォルダがあるか確認
    fs.mkdirSync(downloadsDir); // もしフォルダがなければ、新しく作成します (Syncは「同期的に」、つまり終わるまで待つという意味です)
}

// ウェブサーバーがリクエストを受け取ったときに、最初に行う共通の処理（ミドルウェア）を設定します
app.use(express.json()); // ウェブサイトからのデータがJSON形式（JavaScriptのオブジェクトのような形式）だったら、JavaScriptのオブジェクトに変換して使えるようにします
app.use(express.urlencoded({ extended: true })); // ウェブサイトからのデータがフォームの形式だったら、JavaScriptのオブジェクトに変換して使えるようにします (extended: trueは、より複雑なデータも扱えるようにする設定です)
app.use(cookieParser()); // ウェブサイトからのリクエストに含まれるクッキーを読み取れるようにします
app.use(session({ // セッション機能を使えるように設定します
    secret: SESSION_SECRET, // セッション情報を暗号化するための秘密鍵を指定します
    resave: false, // セッションの内容が変わっていなくても、毎回セッションストアに保存し直すか？（通常はfalseで大丈夫です）
    saveUninitialized: true, // 新しいセッションで何も情報が保存されていなくても、セッションを作成するか？（通常はtrueで大丈夫です）
    // セッション用のクッキー（ブラウザに保存される小さな情報）の設定です
    cookie: { maxAge: 60 * 60 * 1000, secure: false } // maxAgeはクッキーの有効期限で、ここでは1時間（ミリ秒単位）です。secure: falseは、HTTPS（暗号化された安全な通信）でない場合でもクッキーを使う設定です。開発中はfalseで良いですが、本番環境ではtrueにすべきです。
}));

// child_process.execという、外部プログラムを実行する関数を、Promise（非同期処理を扱いやすくしたもの）に変えます
const execPromise = promisify(exec); // これで exec 関数を await と一緒に使えるようになります

// ダウンロードするファイルに、他のファイルと重ならないようにランダムな名前をつける関数です
function generateRandomFileName() {
    // crypto.randomBytes(16)で16バイトのランダムなデータを生成し、
    // .toString('hex')でそれを16進数の文字に変換しています。
    // これで、例えば "a1b2c3d4e5f678901234567890abcdef" のようなランダムな文字列ができます。
    return crypto.randomBytes(16).toString('hex');
}

/**
 * 指定された動画ファイルを、指定された時間が経った後に自動的に削除する関数です。
 * @param {string} filePath - 削除したい動画ファイルがどこにあるかを示すパス（場所）
 * @param {number} delayMilliseconds - ファイルを削除するまで何ミリ秒待つか
 */
async function deleteVideoAfterDelay(filePath, delayMilliseconds) {
    // コンソール（サーバーの実行画面）に「いつ削除するか」を表示します
    console.log(`動画ファイル ${filePath} を ${delayMilliseconds / 1000} 秒後に削除するようスケジュールしました。`);
    // setTimeoutを使って、指定した時間が経ったら中の処理を実行するように設定します
    setTimeout(async () => {
        try {
            // await unlink(filePath)で、ファイルを非同期（他の処理を止めずに）削除します
            await unlink(filePath);
            // 削除が成功したらメッセージを表示
            console.log(`動画ファイルが削除されました: ${filePath}`);
        } catch (error) {
            // ファイル削除中に何か問題が起きた場合
            if (error.code === 'ENOENT') { // もしエラーコードが 'ENOENT'（ファイルが存在しない）だったら
                console.warn(`削除しようとした動画ファイルは既に存在しませんでした: ${filePath}`); // 「もうなかったよ」と警告を表示
            } else { // その他のエラー（削除する権限がない、など）の場合
                console.error(`動画ファイルの削除中にエラーが発生しました: ${filePath}`, error); // エラーの内容を詳しく表示
            }
        }
    }, delayMilliseconds); // ここで指定した時間（ミリ秒）が経ったら上のasync関数が実行されます
}

/**
 * 動画ファイルの長さを調べる関数です。
 * fluent-ffmpegという部品を使って、動画の情報（メタデータ）を読み取ります。
 * @param {string} filePath - 長さを調べたい動画ファイルがどこにあるかを示すパス
 * @returns {Promise<number>} 動画の長さ（秒単位）を教えてくれるPromise（処理結果を待つためのオブジェクト）
 */
function getVideoDuration(filePath) {
    // Promiseを返します。処理が成功したらresolve、失敗したらrejectを呼び出します。
    return new Promise((resolve, reject) => {
        // ffmpeg.ffprobeを使って、動画ファイルのメタデータ（ファイルの種類、長さ、画質などの情報）を取得します
        ffmpeg.ffprobe(filePath, (err, metadata) => {
            if (err) {
                // メタデータ取得中にエラーが発生した場合
                console.error(`動画の長さ取得エラー (ffprobe): ${err.message}`); // エラーメッセージを表示
                return reject(`動画の長さ取得エラー: ${err.message}`); // Promiseを失敗（reject）させます
            }
            // メタデータの中から動画の長さ（duration）を秒単位で取り出します
            const durationInSeconds = metadata.format.duration;
            if (durationInSeconds) {
                 console.log(`動画の長さが取得されました: ${durationInSeconds} 秒`); // 長さが取得できたら表示
                 resolve(durationInSeconds); // 長さをPromiseの成功（resolve）として返します
            } else {
                 console.warn(`動画の長さがメタデータから取得できませんでした: ${filePath}`); // 長さがメタデータになかった場合
                 resolve(0); // その場合は0秒として扱います
            }
        });
    });
}

/**
 * YouTubeの動画を指定されたURLからダウンロードする関数です。
 * yt-dlpという外部プログラムを使います。ダウンロードした動画はWebM形式になります。
 * ダウンロードが終わったら、動画の長さに応じて自動的に削除されるようにスケジュールします。
 * @param {string} youtubeUrl - ダウンロードしたいYouTube動画のアドレス（URL）
 * @returns {Promise<string>} ダウンロードした動画ファイルがどこに保存されたかを示すパスを教えてくれるPromise
 */
function downloadVideo(youtubeUrl) {
    // Promiseを返します。ダウンロードが成功したらresolve、失敗したらrejectを呼び出します。
    return new Promise((resolve, reject) => {
        // ランダムなファイル名（.webmという拡張子付き）を生成します
        const fileName = generateRandomFileName() + '.webm';
        // ダウンロードしたファイルを保存する場所の絶対パス（パソコンのどこにあるかを正確に示すパス）を生成します
        const outputPath = path.join(downloadsDir, fileName);

        // yt-dlpを実行するためのコマンド文字列を作成します
        // -f bestvideo[ext=webm]+bestaudio[ext=webm]/bestvideo+bestaudio: WebM形式の最高画質と最高音質を選びます
        // --merge-output-format webm: 動画と音声をWebMという一つのファイル形式にまとめます
        // --output "${outputPath}": ダウンロードしたファイルをどこに保存するか指定します
        // "${youtubeUrl}": ダウンロードしたいYouTube動画のURLです
        const command = `yt-dlp -f bestvideo[ext=webm]+bestaudio[ext=webm]/bestvideo+bestaudio --merge-output-format webm --output "${outputPath}" "${youtubeUrl}"`;
        console.log(`Executing yt-dlp command: ${command}`); // 実行するコマンドをコンソールに表示します

        // execを使って、作成したコマンドを実行します
        exec(command, (error, stdout, stderr) => {
            if (error) {
                // コマンドの実行中にエラーが発生した場合
                console.error(`yt-dlpエラー: ${stderr}`); // エラーメッセージをコンソールに表示
                reject(`yt-dlpの実行中にエラーが発生しました: ${stderr}`); // Promiseを失敗（reject）させます
            } else {
                // コマンドがエラーなく完了した場合
                console.log(`yt-dlp標準出力:\n${stdout}`); // yt-dlpが出力したメッセージを表示
                // 指定した場所にファイルが本当にダウンロードされたか確認します
                if (fs.existsSync(outputPath)) {
                     console.log(`動画が正常にダウンロードされました (WebM): ${outputPath}`); // ダウンロード成功メッセージ

                     // ダウンロードした動画の長さを調べます
                     getVideoDuration(outputPath)
                         .then(durationInSeconds => {
                             const maxDelaySeconds = 7200; // 動画を自動削除するまでの最大時間（2時間 = 7200秒）
                             const calculatedDelaySeconds = durationInSeconds * 3; // 動画の長さの3倍の時間を計算します
                             // 最終的な削除までの時間は、「動画の長さの3倍」と「最大2時間」の短い方を選びます
                             const finalDelaySeconds = Math.min(calculatedDelaySeconds, maxDelaySeconds);
                             const finalDelayMilliseconds = finalDelaySeconds * 1000; // 秒をミリ秒に変換します

                             // 計算した時間が経ったら動画を削除するようにスケジュールします
                             deleteVideoAfterDelay(outputPath, finalDelayMilliseconds);
                             resolve(outputPath); // ダウンロードしたファイルのパスをPromiseの成功（resolve）として返します
                         })
                         .catch(durationError => {
                             // 動画の長さ取得に失敗した場合
                             console.error(`動画の長さ取得エラー発生、デフォルトの削除時間を適用: ${durationError}`); // エラーメッセージを表示
                             const defaultDelayMilliseconds = 60 * 60 * 1000; // デフォルトの削除時間（1時間）
                             deleteVideoAfterDelay(outputPath, defaultDelayMilliseconds); // デフォルトの時間で削除をスケジュールします
                             resolve(outputPath); // 長さ取得は失敗しましたが、ダウンロード自体は成功しているのでパスを返します
                         });

                } else {
                     // yt-dlpはエラーを出さなかったのに、ファイルが見つからない場合
                     console.error(`yt-dlpはエラーを報告しませんでしたが、出力ファイルが見つかりません: ${outputPath}`);
                     reject(`yt-dlpは成功しましたが、出力ファイルが見つかりません。`); // Promiseを失敗（reject）させます
                }
            }
        });
    });
}

/**
 * 指定されたURLのウェブサイトのコンテンツを取得する関数です。
 * GETやPOSTなどのHTTPメソッド、ヘッダー、送信データなどを指定できます。
 * リダイレクト（アクセスしたURLから別のURLに自動的に飛ばされること）も処理し、最終的にどのURLにたどり着いたかも教えてくれます。
 * @param {string} url - コンテンツを取得したいウェブサイトのアドレス（URL）
 * @param {string} method - HTTPメソッド（'GET'や'POST'など）。デフォルトは'GET'です。
 * @param {object} headers - リクエストに含めたい追加のヘッダー情報（例: どのブラウザからアクセスしているか、など）。デフォルトは空っぽです。
 * @param {any} data - POSTリクエストなどで送信したいデータ。デフォルトはnull（データなし）です。
 * @returns {Promise<{data: Buffer, headers: object, finalUrl: string}>} 取得したコンテンツ（Buffer形式）、応答ヘッダー、最終的なURLを含むオブジェクトを教えてくれるPromise
 */
async function fetchWebPage(url, method = 'GET', headers = {}, data = null) {
    try {
        // axiosを使ってHTTPリクエストを送るための設定（オプション）を作成します
        const options = {
            method: method, // HTTPメソッド
            url: url, // アクセスするURL
            responseType: 'arraybuffer', // 応答データをそのままのバイト列（Buffer）として受け取ります（文字コードの処理を自分でやるため）
            headers: { // リクエストヘッダーの設定
                // ウェブブラウザが通常送るような、基本的なヘッダーを設定します
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7',
                'Accept-Language': 'ja,en-US;q=0.9,en;q=0.8', // 受け取りたい言語の優先順位
                'Connection': 'keep-alive', // 接続を維持する設定
                'Upgrade-Insecure-Requests': '1', // 可能であればHTTPSにアップグレードしたいという意思表示
                ...headers, // 引数で渡された追加のヘッダーをここに追加します（同じ名前のヘッダーがあれば上書きされます）
            },
            maxRedirects: 20 // リダイレクトを最大20回まで追跡します
        };
        // 送信データ（data）がある場合は、オプションに追加します
        if (data) {
            options.data = data; // リクエストボディにデータを設定
        }

        // axiosを使って実際にHTTPリクエストを送信し、応答を待ちます
        const response = await axios(options);
        // リダイレクトがあった場合、最終的にアクセスしたURLを取得します (なければ元のURL)
        const finalUrl = response.request.responseURL || url;
        // リダイレクトが発生したらコンソールに表示します
        if (finalUrl !== url) {
            console.log(`Redirected from ${url} to ${finalUrl}`);
        }
        // 取得したデータ（Buffer）、応答ヘッダー、最終URLをまとめて返します
        return { data: response.data, headers: response.headers, finalUrl: finalUrl };
    } catch (error) {
        // HTTPリクエスト中に何か問題が起きた場合
        console.error(`ページ取得エラー: ${error.message}`); // エラーメッセージを表示
        if (error.response) { // もしサーバーから応答（エラー応答含む）があった場合
            console.error(`ステータスコード: ${error.response.status}`); // HTTPステータスコード（404, 500など）を表示
            if (error.response.data instanceof Buffer) { // 応答データがBuffer形式の場合
                try {
                    // UTF-8でデコードして応答データを表示しようとします
                    console.error(`レスポンスデータ: ${iconv.decode(error.response.data, 'utf-8')}`);
                } catch (e) {
                    // デコードに失敗したら、バイト列を16進数で表示
                    console.error(`レスポンスデータ (デコード失敗): ${error.response.data.toString('hex')}`);
                }
            } else { // 応答データがBufferでない場合
                 console.error(`レスポンスデータ: ${error.response.data}`);
            }
            console.error(`レスポンスヘッダー: ${JSON.stringify(error.response.headers)}`); // 応答ヘッダーをJSON形式で表示
        } else if (error.request) { // リクエストは送ったけど、サーバーから全く応答がなかった場合
            console.error('リクエストは行われませんでしたが、応答がありませんでした');
            console.error(error.request); // リクエストの詳細を表示
        } else { // リクエストを送る前の設定段階でエラーが発生した場合
            console.error('リクエストの設定中にエラーが発生しました');
        }
        throw new Error(`ページ取得エラー: ${error.message}`); // 発生したエラーを呼び出し元に伝えます
    }
}

/**
 * 取得したコンテンツのバイト列（Buffer）を、正しい文字コードで文字列に変換する関数です。
 * サーバーからの応答ヘッダーにある「Content-Type」や、HTMLの中にある文字コード指定（metaタグ）を見て、どの文字コードで書かれているかを判断します。
 * @param {Buffer} buffer - 文字列に変換したいバイト列データ
 * @param {object} headers - サーバーからの応答ヘッダー
 * @returns {string} 文字コード変換された文字列
 */
function decodeContent(buffer, headers) {
    let encoding = 'utf-8'; // まずは一般的なUTF-8だと仮定します

    // 応答ヘッダーの「Content-Type」を見て、文字コード情報（charset=...）があるか確認します
    const contentType = headers['content-type'];
    if (contentType) {
        const charsetMatch = contentType.match(/charset=([^;]+)/i); // 「charset=」の後に続く文字コード名を正規表現で探します
        if (charsetMatch && charsetMatch[1]) {
            const determinedEncoding = charsetMatch[1].toLowerCase(); // 見つかった文字コード名を小文字に変換
            // iconv-liteという部品がその文字コードを扱えるか確認します
            if (iconv.encodingExists(determinedEncoding)) {
                encoding = determinedEncoding; // 扱えるなら、その文字コードを使います
                console.log(`Detected encoding from Content-Type: ${encoding}`); // どの文字コードを使ったか表示
            } else {
                // 扱えない文字コードだった場合
                console.warn(`Unsupported encoding from Content-Type: ${determinedEncoding}, falling back to ${encoding}`); // 警告を表示し、最初の仮定（UTF-8）を使います
            }
        }
    }

    // Content-TypeがHTMLの場合、HTMLの中のmetaタグ（<meta charset="...">など）も見て、文字コードを探します
    if (contentType && contentType.includes('text/html')) {
        try {
            // HTMLの最初の部分（最大4096バイト）だけをUTF-8で一度デコードしてみて、metaタグを探します
            // fatal: falseは、エラーがあっても処理を止めない設定です
            const tempHtml = iconv.decode(buffer.slice(0, 4096), 'utf-8', { fatal: false, specialChars: true });
            // <meta charset="..."> または <meta http-equiv="Content-Type" content="...; charset=..."> の形式でcharsetを探す正規表現
            const charsetMetaMatch = tempHtml.match(/<meta\s+[^>]*charset=["']?([^"' >]+)["']?/i);
            if (charsetMetaMatch && charsetMetaMatch[1]) {
                const determinedEncoding = charsetMetaMatch[1].toLowerCase(); // 見つかった文字コード名を小文字に変換
                 // iconv-liteがその文字コードを扱えるか確認します
                 if (iconv.encodingExists(determinedEncoding)) {
                    encoding = determinedEncoding; // 扱えるなら、その文字コードを使います
                    console.log(`Detected encoding from meta tag: ${encoding}`); // どの文字コードを使ったか表示
                } else {
                    // 扱えない文字コードだった場合
                    console.warn(`Unsupported encoding from meta tag: ${determinedEncoding}, falling back to ${encoding}`); // 警告を表示し、Content-Typeまたは最初の仮定の文字コードを使います
                }
            }
        } catch (e) {
            console.error("Error detecting encoding from meta tag:", e); // metaタグからの文字コード検出中にエラーが発生した場合
        }
    }

    // 最終的に決まった文字コードを使って、バイト列（buffer）を文字列に変換します
    try {
        return iconv.decode(buffer, encoding);
    } catch (e) {
        // もしその文字コードでの変換に失敗した場合
        console.error(`Failed to decode with ${encoding}, attempting utf-8:`, e); // エラーを表示し、UTF-8で再度試みます
        try {
             // UTF-8でデコードします (エラーがあっても処理を止めない設定付き)
             return iconv.decode(buffer, 'utf-8', { fatal: false, specialChars: true });
        } catch (e2) {
             // UTF-8でも失敗した場合
             console.error("Failed to decode with utf-8:", e2); // エラーを表示
             return buffer.toString('utf-8'); // 最終手段として、BufferオブジェクトのtoString('utf-8')を使います
        }
    }
}


/**
 * ウェブサイトのHTMLコンテンツの中にある、他のページへのリンク（aタグのhref）や画像のアドレス（imgタグのsrc）、フォームの送信先（formタグのaction）などを、
 * このプロキシサーバーを経由するように書き換える関数です。
 * 元のURLは、後で元に戻せるようにBase64という形式でエンコードして、プロキシのURLに含めます。
 * @param {string} html - 書き換えたいHTMLコンテンツの文字列
 * @param {string} baseUrl - このHTMLコンテンツを取得したページの元のURL（リダイレクト後の最終的なURL）。相対パス（例: /images/logo.png）を絶対パス（例: https://example.com/images/logo.png）に変換するために使います。
 * @returns {string} URLがプロキシ経由に書き換えられたHTMLコンテンツの文字列
 */
function rewriteUrls(html, baseUrl) {
    const $ = cheerio.load(html); // Cheerioを使って、HTMLを操作できる状態にします

    // ウェブサイトのアドレス（URL）が含まれる可能性のあるHTMLのタグと、そのアドレスが書かれている属性の名前をリストアップします
    const elementsWithUrls = {
        'a': 'href', // リンクのタグとそのアドレス属性
        'link': 'href', // CSSファイルなどを読み込むタグとそのアドレス属性
        'img': 'src', // 画像を表示するタグとそのアドレス属性
        'script': 'src', // JavaScriptファイルを読み込むタグとそのアドレス属性
        'iframe': 'src', // 別のページを埋め込むタグとそのアドレス属性
        'source': 'src', // videoタグやaudioタグの中で、動画や音声のファイルを指定するタグとそのアドレス属性
        'video': 'src', // videoタグ自体のアドレス属性
        'audio': 'src', // audioタグ自体のアドレス属性
        'track': 'src', // videoタグなどで字幕ファイルを指定するタグとそのアドレス属性
    };

    // 上でリストアップした各タグの種類ごとに処理を繰り返します
    Object.keys(elementsWithUrls).forEach(selector => {
        const attribute = elementsWithUrls[selector]; // 処理対象の属性名（hrefまたはsrc）を取得します
        $(selector).each((index, element) => { // 指定したタグ（セレクタ）にマッチする要素を一つずつ処理します
            const $element = $(element); // その要素をCheerioで扱えるオブジェクトとして取得
            let originalUrl = $element.attr(attribute); // その要素の元の属性値（URL）を取得します

            // URLが存在し、かつ「data:」で始まるデータURLや、「#」で始まるページ内リンクでない場合のみ処理します
            if (originalUrl && !originalUrl.startsWith('data:') && !originalUrl.startsWith('#')) {
                try {
                    // 元のURLが相対パス（例: /about）の場合、baseUrl（そのページがある場所）と組み合わせて絶対パス（例: https://example.com/about）に変換します
                    const resolvedUrl = urlModule.resolve(baseUrl, originalUrl);
                    // 新しいプロキシ経由のURLを作成します。形式は「/proxy?url=Base64エンコードされた元のURL」です。
                    // Buffer.from(resolvedUrl).toString('base64')で、絶対パスをBase64という形式の文字列に変換しています。
                    const proxiedUrl = `/proxy?url=${Buffer.from(resolvedUrl).toString('base64')}`;
                    // 要素の元の属性値（hrefやsrc）を、作成したプロキシ経由のURLに書き換えます
                    $element.attr(attribute, proxiedUrl);
                } catch (e) {
                    // URLの書き換え中にエラーが発生した場合
                    console.error(`URLの書き換え中にエラーが発生しました: ${originalUrl} (Base: ${baseUrl})`, e); // エラーの内容を表示
                }
            }
        });
    });

    // フォーム（formタグ）の送信先（action属性）を書き換える処理です
    $('form').each((index, element) => {
        const $element = $(element); // フォーム要素をCheerioオブジェクトとして取得
        let originalAction = $element.attr('action'); // 元のaction属性値を取得
        const method = $element.attr('method') || 'GET'; // フォームの送信方法（method属性）を取得します。指定がない場合はGETとみなします。

        // action属性が存在し、かつデータURLでない場合
        if (originalAction && !originalAction.startsWith('data:')) {
             try {
                // 元のactionのURLをbaseUrlに対して絶対URLに変換します
                const resolvedActionUrl = urlModule.resolve(baseUrl, originalAction);
                $element.attr('action', '/proxy'); // フォームの送信先を、このプロキシサーバーの「/proxy」というアドレスに書き換えます
                $element.attr('method', 'POST'); // フォームの送信方法を強制的にPOSTにします（プロキシでデータを受け取るため）
                // 元の送信先URLと元の送信方法を、フォームの中に隠しフィールド（type="hidden"）として追加します。
                // これで、プロキシサーバーは「このフォームは元々このURLにこの方法で送られるはずだったんだな」と知ることができます。
                $element.append(`<input type="hidden" name="__proxy_target_url" value="${Buffer.from(resolvedActionUrl).toString('base64')}">`);
                $element.append(`<input type="hidden" name="__proxy_target_method" value="${method.toUpperCase()}">`); // メソッド名は大文字にします
             } catch (e) {
                 // action書き換え中にエラーが発生した場合
                 console.error(`Form Actionの書き換え中にエラーが発生しました: ${originalAction} (Base: ${baseUrl})`, e); // エラーの内容を表示
             }
        } else if (!originalAction) {
             // action属性が指定されていない場合（これは通常、現在のページにフォームの内容を送信するという意味です）
             const resolvedActionUrl = baseUrl; // この場合は、現在のページのURL（baseUrl）を送信先とみなします
             $element.attr('action', '/proxy'); // 送信先をプロキシの「/proxy」に書き換え
             $element.attr('method', 'POST'); // 送信方法を強制的にPOSTに
             // 元の送信先URL（現在のページURL）と元の送信方法を隠しフィールドとして追加します
             $element.append(`<input type="hidden" name="__proxy_target_url" value="${Buffer.from(resolvedActionUrl).toString('base64')}">`);
             $element.append(`<input type="hidden" name="__proxy_target_method" value="${method.toUpperCase()}">`);
        }
    });

    // HTMLのheadタグの中にある <base> タグを削除します。
    // <base>タグは、ページ内の相対パスの基準となるURLを指定するものですが、
    // プロキシがURLを書き換えるため、元の<base>タグがあるとURLの解決がおかしくなる可能性があります。
    $('base').remove();

    // <style> タグ（HTMLの中に直接書かれたCSS）の中にある url() で指定されたURLを書き換える処理です
    $('style').each((index, element) => {
        const $element = $(element); // style要素をCheerioオブジェクトとして取得
        let styleContent = $element.html(); // styleタグの中のCSSのコードを取得
        if (styleContent) { // CSSコードが存在する場合
            // CSSコードの中から「url(...)」や「url('...')」、「url("...")」の形式で書かれた部分を正規表現で探し、置き換えます
            styleContent = styleContent.replace(/url\(['"]?(.*?)['"]?\)/g, (match, url) => {
                // url(...) の中のURLが存在し、データURLでない場合のみ処理
                if (url && !url.startsWith('data:')) {
                    try {
                        // CSS内のURLが相対パスの場合、baseUrlに対して絶対URLに変換します
                        const resolvedUrl = urlModule.resolve(baseUrl, url);
                        // プロキシ経由のURLを作成します。形式は「/proxy?url=Base64エンコードされた絶対URL」です。
                        const proxiedUrl = `/proxy?url=${Buffer.from(resolvedUrl).toString('base64')}`;
                        return `url('${proxiedUrl}')`; // 書き換えたプロキシURLを含む「url('...')」形式の文字列を返します
                    } catch (e) {
                         // URL書き換え中にエラーが発生した場合
                         console.error(`Style URLの書き換え中にエラーが発生しました: ${url} (Base: ${baseUrl})`, e); // エラーの内容を表示
                         return match; // エラー時は元の文字列をそのまま返します
                    }
                }
                return match; // データURLなどの場合は元の文字列をそのまま返します
            });
            $element.html(styleContent); // 書き換えたCSSコードでstyleタグの内容を更新します
        }
    });

    return $.html(); // 全ての書き換えが終わったHTMLコンテンツ全体を文字列として返します
}

/**
 * 外部CSSファイル（.cssファイル）のコンテンツの中にある url() で指定されたURLを、プロキシ経由に書き換える関数です。
 * rewriteUrls関数の中のstyleタグの処理と似ていますが、こちらはCSSファイル全体を対象とします。
 * @param {string} css - 書き換えたいCSSコンテンツの文字列
 * @param {string} baseUrl - このCSSコンテンツを読み込んだページの元のURL（リダイレクト後の最終的なURL）。相対パスの解決に使用されます。
 * @returns {string} URLがプロキシ経由に書き換えられたCSSコンテンツの文字列
 */
function rewriteCssUrls(css, baseUrl) {
    // CSSコードの中から「url(...)」や「url('...')」、「url("...")」の形式で書かれた部分を正規表現で探し、置き換えます
    const rewrittenCss = css.replace(/url\(['"]?(.*?)['"]?\)/g, (match, url) => {
        // url(...) の中のURLが存在し、データURLでない場合のみ処理
        if (url && !url.startsWith('data:')) {
            try {
                // CSS内のURLが相対パスの場合、baseUrlに対して絶対URLに変換します
                const resolvedUrl = urlModule.resolve(baseUrl, url);
                // プロキシ経由のURLを作成します。形式は「/proxy?url=Base64エンコードされた絶対URL」です。
                const proxiedUrl = `/proxy?url=${Buffer.from(resolvedUrl).toString('base64')}`;
                return `url('${proxiedUrl}')`; // 書き換えたプロキシURLを含む「url('...')」形式の文字列を返します
            } catch (e) {
                 // URL書き換え中にエラーが発生した場合
                 console.error(`CSS URLの書き換え中にエラーが発生しました: ${url} (Base: ${baseUrl})`, e); // エラーの内容を表示
                 return match; // エラー時は元の文字列をそのまま返します
            }
        }
        return match; // データURLなどの場合は元の文字列をそのまま返します
    });
    return rewrittenCss; // 書き換え後のCSSコンテンツ全体を文字列として返します
}

// ユーザーがログインしているか（認証済みか）を確認するためのミドルウェア関数です。
// この関数をルートハンドラ（特定のURLへのリクエストを処理する関数）の前に挟むことで、ログインしていないユーザーからのアクセスを防ぐことができます。
function isAuthenticated(req, res, next) {
    // セッション情報が存在し、かつセッションに「authenticated」というフラグがtrueで保存されているか確認します
    if (req.session && req.session.authenticated) {
        return next(); // 認証済みであれば、次の処理（本来のルートハンドラ）に進みます
    } else {
        res.redirect('/login'); // 認証されていない場合は、ログインページに自動的にリダイレクトします
    }
}

// '/login' というアドレスへのGETリクエスト（ブラウザで直接アクセスした場合など）を処理する部分です。
// ログインページを表示します。
app.get('/login', (req, res) => {
    // ログインページのHTMLコードをクライアント（ブラウザ）に送信します。
    // ここに書かれているHTMLがブラウザに表示されます。
    res.send(`
        <!DOCTYPE html>
        <html>
        <head>
            <meta charset="UTF-8"> // 文字コードをUTF-8に設定
            <meta name="viewport" content="width=device-width, initial-scale=1.0"> // スマートフォンなど、画面の大きさに合わせて表示を調整する設定
            <title>ログイン</title> // ページのタイトル
            <style> // ページの見た目を整えるCSSスタイル
                body { font-family: sans-serif; margin: 40px; background-color: #f4f4f4; color: #333; display: flex; justify-content: center; align-items: center; min-height: 80vh; } // ページ全体のスタイル
                .container { background-color: #fff; padding: 30px; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.1); text-align: center; } // ログインフォームを囲む領域のスタイル
                h1 { color: #0056b3; margin-bottom: 20px; } // タイトルのスタイル
                form { display: flex; flex-direction: column; gap: 15px; } // フォーム全体のスタイル（要素を縦に並べ、間隔を空ける）
                input[type="password"] { padding: 10px; border: 1px solid #ccc; border-radius: 4px; font-size: 1rem; } // パスワード入力欄のスタイル
                button { padding: 10px 20px; background-color: #007bff; color: white; border: none; border-radius: 4px; cursor: pointer; font-size: 1rem; transition: background-color 0.3s ease; } // ボタンのスタイル
                button:hover { background-color: #0056b3; } // ボタンにマウスカーソルが乗ったときのスタイル
                .error { color: red; margin-top: 15px; } // エラーメッセージのスタイル（赤字で表示）
            </style>
        </head>
        <body>
            <div class="container">
                <h1>プロキシサイト ログイン</h1> // ページのタイトル
                <form action="/login" method="post"> // ログインフォーム。入力されたデータは/loginというアドレスにPOSTメソッドで送信されます。
                    <input type="password" name="password" placeholder="パスワードを入力" required> // パスワード入力欄。name="password"で入力された値がサーバーに送られます。requiredは入力必須にする設定です。
                    <button type="submit">ログイン</button> // 送信ボタン
                </form>
                ${req.query.error ? `<p class="error">${req.query.error}</p>` : ''} // URLに「?error=何かメッセージ」という形でエラー情報が含まれていたら、そのメッセージを赤字で表示します。
            </div>
        </body>
        </html>
    `);
});

// '/login' というアドレスへのPOSTリクエスト（ログインフォームが送信されたとき）を処理する部分です。
// ログイン処理を行います。
app.post('/login', (req, res) => {
    const password = req.body.password; // リクエストボディ（フォームから送られてきたデータ）の中から、name="password"の値（入力されたパスワード）を取り出します

    // 入力されたパスワードが、コードで設定した秘密のパスワードと一致するか確認します
    if (password === SECRET_PASSWORD) {
        req.session.authenticated = true; // パスワードが正しければ、このユーザーのセッションに「authenticated」（認証済み）というフラグをtrueで保存します
        res.redirect('/'); // 認証に成功したら、ルートパス（'/'）にリダイレクト（自動的に移動）させます
    } else {
        // パスワードが間違っている場合
        // ログインページにリダイレクトし、エラーメッセージをURLに含めます。
        // encodeURIComponentは、エラーメッセージにURLに使えない文字が含まれていても大丈夫なように変換する処理です。
        res.redirect('/login?error=' + encodeURIComponent('パスワードが間違っています。'));
    }
});

// '/logout' というアドレスへのGETリクエスト（ログアウトリンクをクリックした場合など）を処理する部分です。
// ログアウト処理を行います。
app.get('/logout', (req, res) => {
    // req.session.destroy()で、このユーザーのセッション情報をサーバーから削除します。
    req.session.destroy((err) => {
        if (err) {
            // セッション削除中にエラーが発生した場合
            console.error("セッション破棄エラー:", err); // エラーをコンソールに表示
            res.status(500).send("ログアウトに失敗しました。"); // クライアントにサーバーエラー（500）を伝えます
        } else {
            res.redirect('/login'); // セッション削除が成功したら、ログインページにリダイレクトします
        }
    });
});

// ルートパス ('/') へのGETリクエストを処理する部分です。
// isAuthenticatedミドルウェアが先に実行され、ログインしているユーザーだけがここに到達できます。
// プロキシを使ってURLを入力するページを表示します。
app.get('/', isAuthenticated, (req, res) => {
    // プロキシ利用ページのHTMLコードをクライアント（ブラウザ）に送信します。
    res.send(`
        <!DOCTYPE html>
        <html>
        <head>
            <meta charset="UTF-8"> // 文字コードをUTF-8に設定
            <meta name="viewport" content="width=device-width, initial-scale=1.0"> // 画面サイズ調整
            <title>プロキシサイト</title> // ページのタイトル
            <style> // ページの見た目を整えるCSSスタイル
                body { font-family: sans-serif; margin: 40px; background-color: #f4f4f4; color: #333; } // ページ全体のスタイル
                .container { max-width: 800px; margin: 0 auto; background-color: #fff; padding: 20px; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.1); } // コンテンツを囲む領域のスタイル（中央寄せ、最大幅800px）
                h1 { color: #0056b3; } // タイトルのスタイル
                form { display: flex; gap: 10px; margin-bottom: 20px; } // フォーム全体のスタイル（要素を横に並べ、間隔を空ける）
                input[type="text"] { flex-grow: 1; padding: 10px; border: 1px solid #ccc; border-radius: 4px; font-size: 1rem; } // テキスト入力欄のスタイル（幅を広げる設定）
                button { padding: 10px 20px; background-color: #007bff; color: white; border: none; border-radius: 4px; cursor: pointer; font-size: 1rem; transition: background-color 0.3s ease; } // ボタンのスタイル
                button:hover { background-color: #0056b3; } // ボタンにマウスカーソルが乗ったときのスタイル
                p { color: #666; font-size: 0.9rem; } // 注意書きなどの段落のスタイル
                .error { color: red; margin-top: 10px; } // エラーメッセージのスタイル
                 .logout-link { display: block; text-align: right; margin-bottom: 20px; } // ログアウトリンクのスタイル（右寄せ）
            </style>
        </head>
        <body>
            <div class="container">
                 <a href="/logout" class="logout-link">ログアウト</a> // ログアウトするためのリンク
                 <h1>プロキシ経由でコンテンツにアクセス</h1> // ページのタイトル
                <form action="/proxy" method="post"> // URL入力フォーム。入力されたURLは/proxyというアドレスにPOSTメソッドで送信されます。
                    <input type="text" name="url" placeholder="URLを入力 (例: https://www.google.com)" required> // URL入力欄。name="url"で入力された値がサーバーに送られます。入力必須です。
                    <button type="submit">アクセス</button> // 送信ボタン
                </form>
                <p>注意: 動画のストリーミングには少し時間がかかる場合があります。</p> // 注意書き
                 ${req.query.error ? `<p class="error">${req.query.error}</p>` : ''} // URLにエラー情報が含まれていたら表示
            </div>
        </body>
        </html>
    `);
});


// '/proxy' というアドレスへのPOSTリクエストを処理する部分です。
// isAuthenticatedミドルウェアが先に実行され、ログインしているユーザーだけがここに到達できます。
// ここで、フォームから送信されたURLにアクセスし、コンテンツを取得してクライアントに返します。
app.post('/proxy', isAuthenticated, async (req, res) => {
    let targetUrl = req.body.url; // リクエストボディ（フォームから送られてきたデータ）の中から、name="url"の値（アクセスしたいURL）を取り出します
    let targetMethod = 'GET'; // 外部サイトへアクセスする際のHTTPメソッドをデフォルトでGETに設定
    let requestBody = req.body; // リクエストボディ全体を取得
    let isFormSubmission = false; // このリクエストが、書き換えられたフォームからの送信かどうかを判定するフラグ

    // もしリクエストボディに「__proxy_target_url」という隠しフィールドが含まれていたら、これは書き換えられたフォームからの送信です
    if (requestBody && requestBody.__proxy_target_url) {
        isFormSubmission = true; // フラグをtrueに設定
        try {
            // 隠しフィールドにBase64でエンコードされて保存されていた元のURLとメソッドをデコードします
            targetUrl = Buffer.from(requestBody.__proxy_target_url, 'base64').toString('utf-8');
            targetMethod = requestBody.__proxy_target_method || 'GET'; // 元のメソッドを取得（なければGET）
            console.log(`Received proxied form submission to: ${targetUrl} with method ${targetMethod}`); // ログに表示

            // プロキシ用の隠しフィールドは不要なので削除します
            delete requestBody.__proxy_target_url;
            delete requestBody.__proxy_target_method;

        } catch (e) {
            // デコードに失敗した場合
            console.error("Failed to decode proxy target URL or method from form data:", e); // エラーを表示
            return res.status(400).send('Invalid proxy target information.'); // クライアントにエラー応答を返して処理を終了
        }
    } else if (!targetUrl) {
        // フォーム送信ではなく、かつURLが指定されていない場合
        console.error("URLが指定されていません (POST)"); // エラーをログに表示
        return res.redirect('/?error=' + encodeURIComponent('URLを指定してください。')); // エラーメッセージ付きでトップページにリダイレクト
    } else {
         // フォーム送信ではないがURLが指定されている場合（例: トップページの入力フォームから送信された場合）
         try {
              // 受け取ったURLがBase64エンコードされている可能性があるのでデコードを試みます
              const decodedUrl = Buffer.from(targetUrl, 'base64').toString('utf-8');
              // デコードした結果が有効なURL（http://またはhttps://で始まる）であれば、それを採用します
              if (decodedUrl && (decodedUrl.startsWith('http://') || decodedUrl.startsWith('https://'))) {
                  targetUrl = decodedUrl;
                  console.log(`Received Base64 encoded URL (initial), decoded to: ${targetUrl}`); // デコード後のURLを表示
              } else {
                  console.log(`Received non-Base64 or invalid URL (initial): ${targetUrl}`); // Base64でないか無効なURLだった場合
              }
          } catch (e) {
              // Base64デコードに失敗した場合
              console.error(`Base64 decoding failed (initial), using original URL: ${targetUrl}`, e); // エラーを表示し、元のURLを使います
          }

          // 受け取ったURLが「http://」または「https://」で始まらない場合（相対パスなどの場合）
          if (!targetUrl.startsWith('http://') && !targetUrl.startsWith('https://')) {
               try {
                   // このプロキシサーバーのベースURL（例: http://localhost:3000/）を取得します
                   const proxyBaseUrl = `${req.protocol}://${req.get('host')}/`;
                   // 受け取ったURLを、プロキシのベースURLに対して絶対URLに変換します
                   const resolvedInitialUrl = urlModule.resolve(proxyBaseUrl, targetUrl);

                   // 解決したURLが有効な絶対URLであれば採用します
                   if (resolvedInitialUrl.startsWith('http://') || resolvedInitialUrl.startsWith('https://')) {
                       targetUrl = resolvedInitialUrl;
                       console.log(`Resolved initial input relative URL: ${targetUrl}`); // 解決後のURLを表示
                   } else {
                       // 解決したURLが無効な場合
                       console.error(`Invalid initial input URL after resolution: ${resolvedInitialUrl}`); // エラーを表示
                       return res.redirect('/?error=' + encodeURIComponent('無効なURL形式です。フルURLを入力してください。')); // エラーメッセージ付きでリダイレクト
                   }
               } catch (e) {
                   // URL解決中にエラーが発生した場合
                   console.error(`Error resolving initial input URL: ${targetUrl}`, e); // エラーを表示
                   return res.redirect('/?error=' + encodeURIComponent('URLの解決中にエラーが発生しました。')); // エラーメッセージ付きでリダイレクト
               }
          }

          targetMethod = 'GET'; // 外部サイトへアクセスするメソッドをGETに設定
          requestBody = null; // リクエストボディはなし
    }

    // クライアント（ブラウザ）から送られてきたヘッダー情報を取得します
    const userAgent = req.headers['user-agent']; // ユーザーエージェント（どのブラウザかなど）
    const referer = req.headers['referer']; // どのページから来たか

    // 外部サイトへリクエストを送る際に使用するヘッダーを作成します
    const requestHeaders = {
        'Accept': req.headers['accept'] || 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7', // 受け入れ可能なコンテンツタイプ
        'Accept-Language': req.headers['accept-language'] || 'ja,en-US;q=0.9,en;q=0.8', // 受け入れ可能な言語
        'User-Agent': userAgent || 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36', // ユーザーエージェント（もしクライアントから送られてこなければデフォルト値を設定）
        'Connection': 'keep-alive', // 接続を維持する設定
        'Upgrade-Insecure-Requests': '1', // HTTPSにアップグレードしたい意思表示
        ...(referer && { 'Referer': referer }), // Refererヘッダーがあれば追加
         // クライアントから送られてきたヘッダーのうち、一部を除く他のヘッダーもコピーします
         ...Object.keys(req.headers).reduce((acc, headerName) => {
             // 除外するヘッダーのリスト（プロキシとして自分で設定するため、元のものは使わない）
             if (!['host', 'cookie', 'content-type', 'content-length', 'connection', 'user-agent', 'referer', 'accept', 'accept-language', 'upgrade-insecure-requests'].includes(headerName.toLowerCase())) {
                  acc[headerName] = req.headers[headerName]; // 除外リストにないヘッダーはコピー
             }
             return acc; // 累積オブジェクトを返す
         }, {}) // 初期値は空のオブジェクト
    };

    // もしPOSTリクエストで、かつリクエストボディがある場合
    if (targetMethod === 'POST' && requestBody) {
        requestHeaders['Content-Type'] = 'application/x-www-form-urlencoded'; // コンテンツタイプをフォームデータ形式に設定
        if (typeof requestBody !== 'string') {
             requestBody = qs.stringify(requestBody); // リクエストボディが文字列でなければ、qsを使ってURLエンコードされた文字列に変換
        }
    }

    try {
        // アクセスしようとしているURLがYouTube動画のURLかどうかを判定する正規表現
        const youtubeRegex = /^(https?:\/\/)?(www\.)?(youtube\.com|youtu\.be)\/.+$/;

        // もしGETリクエストで、フォームからの送信ではなく、かつYouTubeのURLであれば
        if (targetMethod === 'GET' && !isFormSubmission && youtubeRegex.test(targetUrl)) {
             console.log(`YouTube動画のURLが指定されました: ${targetUrl}`); // ログに表示
             // downloadVideo関数を使って動画をダウンロードします
             const videoPath = await downloadVideo(targetUrl);
             // ダウンロードした動画ファイルのファイル名を取得します
             const videoFileName = path.basename(videoPath);
             // このプロキシサーバー上の動画ファイルへの直接URLを作成します
             const videoUrl = `${req.protocol}://${req.get('host')}/video/${videoFileName}`;
             console.log(`動画ファイルへの直接URL: ${videoUrl}`); // ログに表示
             // クライアントをこの動画ファイルへのURLにリダイレクトさせます。
             // これにより、ブラウザが直接動画ファイルを読み込み、ストリーミング再生が始まります。
             res.redirect(videoUrl);

        } else {
            // YouTube動画ではない、またはPOSTリクエストの場合
            console.log(`ターゲットURLにアクセスします (${targetMethod}): ${targetUrl}`); // ログに表示
            // fetchWebPage関数を使って、指定されたURLのコンテンツを取得します
            const { data: pageContentBuffer, headers, finalUrl } = await fetchWebPage(targetUrl, targetMethod, requestHeaders, requestBody);
            const contentType = headers['content-type']; // 取得したコンテンツのContent-Typeヘッダーを取得

            // 取得したコンテンツがHTMLの場合
            if (contentType && contentType.includes('text/html')) {
                 // decodeContent関数を使って、取得したBufferデータを文字列（HTMLコード）に変換します
                 const pageContent = decodeContent(pageContentBuffer, headers);
                 // rewriteUrls関数を使って、HTMLコード内のURLをプロキシ経由に書き換えます
                 const rewrittenHtml = rewriteUrls(pageContent, finalUrl);
                 // リダイレクト後の最終的なURLをセッションに保存しておきます（後で相対パスの解決に使うため）
                 req.session.lastProxiedUrl = finalUrl;
                 console.log(`Saved last proxied URL to session: ${finalUrl}`); // 保存したURLをログに表示
                 res.setHeader('Content-Type', 'text/html; charset=utf-8'); // 応答ヘッダーのContent-TypeをHTML（UTF-8）に設定
                 res.send(rewrittenHtml); // 書き換えたHTMLコードをクライアントに送信します
            } else if (contentType && contentType.includes('text/css')) {
                 // 取得したコンテンツがCSSの場合
                 // decodeContent関数を使って、取得したBufferデータを文字列（CSSコード）に変換します
                 const pageContent = decodeContent(pageContentBuffer, headers);
                 // rewriteCssUrls関数を使って、CSSコード内のURLをプロキシ経由に書き換えます
                 const rewrittenCss = rewriteCssUrls(pageContent, finalUrl);
                 res.setHeader('Content-Type', 'text/css; charset=utf-8'); // 応答ヘッダーのContent-TypeをCSS（UTF-8）に設定
                 res.send(rewrittenCss); // 書き換えたCSSコードをクライアントに送信します
            } else {
                // HTMLでもCSSでもない場合（画像、動画、その他のファイルなど）
                // 取得した元のヘッダー情報をクライアントにそのまま返します（Content-EncodingとContent-Lengthは除く）
                for (const header in headers) {
                     if (header.toLowerCase() === 'content-type') {
                         // Content-Typeヘッダーは、文字コード情報があれば削除し、テキストの場合はUTF-8を追加します
                         const cleanContentType = contentType.replace(/;\s*charset=[^;]+/i, '');
                         if (cleanContentType.startsWith('text/')) {
                              res.setHeader('Content-Type', cleanContentType + '; charset=utf-8');
                         } else {
                              res.setHeader('Content-Type', cleanContentType);
                         }
                     } else if (header.toLowerCase() !== 'content-encoding' && header.toLowerCase() !== 'content-length') {
                         res.setHeader(header, headers[header]); // Content-EncodingとContent-Length以外のヘッダーをそのままコピー
                     }
                }
                res.send(pageContentBuffer); // 取得したコンテンツのBufferデータをそのままクライアントに送信します
            }
        }
    } catch (error) {
        // コンテンツ取得や処理中にエラーが発生した場合
        console.error(`処理中にエラーが発生しました (POST): ${error.message}`); // エラーをログに表示
        // エラーメッセージ付きでトップページにリダイレクトします
        res.redirect('/?error=' + encodeURIComponent(`処理に失敗しました: ${error.message}`));
    }
});

// '/proxy' というアドレスへのGETリクエストを処理する部分です。
// isAuthenticatedミドルウェアが先に実行され、ログインしているユーザーだけがここに到達できます。
// これは主に、rewriteUrls関数で書き換えられたHTML内のリンク（/proxy?url=...）や、CSS内のurl()（/proxy?url=...）からのリクエストを処理します。
app.get('/proxy', isAuthenticated, async (req, res) => {
    let targetUrl = req.query.url; // URLのクエリパラメータ（?url=...）から、アクセスしたいURL（Base64エンコードされている）を取得します
    const refererUrl = req.headers['referer']; // どのページからこのリクエストが来たかを示すRefererヘッダーを取得

    // もしターゲットURLが指定されていない場合
    if (!targetUrl) {
        const requestedPath = req.path; // リクエストされたパス（例: /proxy/images/logo.png）を取得
        const lastProxiedUrl = req.session.lastProxiedUrl; // セッションに保存しておいた、最後にアクセスしたページのURLを取得

        // もし最後にアクセスしたページのURLがセッションにあって、かつリクエストされたパスがルートパス('/')でなければ
        // （これは、HTML内の相対パス（例: /images/logo.png）がプロキシ経由でリクエストされた可能性が高いです）
        if (lastProxiedUrl && requestedPath !== '/') {
            console.warn(`Caught potential direct relative path access: ${requestedPath}. Attempting to resolve against last proxied URL: ${lastProxiedUrl}`); // 警告をログに表示
            try {
                // リクエストされた相対パスを、最後にアクセスしたページのURLに対して絶対URLに変換します
                const resolvedUrl = urlModule.resolve(lastProxiedUrl, requestedPath);
                // 解決した絶対URLを使って、正しいプロキシ経由のURL（/proxy?url=Base64...）を作成します
                const correctProxiedUrl = `/proxy?url=${Buffer.from(resolvedUrl).toString('base64')}`;
                console.log(`Redirecting to correct proxied URL: ${correctProxiedUrl}`); // リダイレクト先のURLをログに表示
                return res.redirect(correctProxiedUrl); // 正しいプロキシ経由のURLにリダイレクトさせます
            } catch (e) {
                // URL解決中にエラーが発生した場合
                console.error(`Error resolving relative path ${requestedPath} against ${lastProxiedUrl}:`, e); // エラーを表示
                return res.status(500).send(`Error resolving relative path.`); // クライアントにエラー応答を返して処理を終了
            }
        } else {
            // ターゲットURLが指定されておらず、セッションにも最後にアクセスしたURLがない場合
            console.error("URLが指定されていません (GET) and no last proxied URL in session."); // エラーをログに表示
            return res.status(400).send('URLを指定してください。またはセッション情報がありません。'); // クライアントにエラー応答を返して処理を終了
        }
    }

    try {
         // クエリパラメータから取得したターゲットURL（Base64エンコードされているはず）をデコードします
         const decodedUrl = Buffer.from(targetUrl, 'base64').toString('utf-8');
         // デコードした結果が有効なURL（http://またはhttps://で始まる）であれば、それを採用します
         if (decodedUrl && (decodedUrl.startsWith('http://') || decodedUrl.startsWith('https://'))) {
             targetUrl = decodedUrl;
             console.log(`Received Base64 encoded URL, decoded to: ${targetUrl}`); // デコード後のURLを表示
         } else {
             // Base64でないか無効なURLだった場合
             console.log(`Received non-Base64 or invalid URL: ${targetUrl}`); // ログに表示
         }
     } catch (e) {
         // Base64デコードに失敗した場合
         console.error(`Base64 decoding failed, using original URL: ${targetUrl}`, e); // エラーを表示し、元のURLを使います
     }

    // クライアント（ブラウザ）から送られてきたヘッダー情報を取得します
    const userAgent = req.headers['user-agent']; // ユーザーエージェント

    // 外部サイトへリクエストを送る際に使用するヘッダーを作成します
    const requestHeaders = {
        'Accept': req.headers['accept'] || '*/*', // 受け入れ可能なコンテンツタイプ（デフォルトは全て）
        'Accept-Language': req.headers['accept-language'] || 'ja,en-US;q=0.9,en;q=0.8', // 受け入れ可能な言語
        'User-Agent': userAgent || 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36', // ユーザーエージェント
        'Connection': 'keep-alive', // 接続を維持する設定
        ...(refererUrl && { 'Referer': refererUrl }), // Refererヘッダーがあれば追加
         // Sec-Fetch関連のヘッダーがあれば追加（ブラウザが自動で送るセキュリティ関連のヘッダー）
         ...(req.headers['sec-fetch-site'] && { 'Sec-Fetch-Site': req.headers['sec-fetch-site'] }),
         ...(req.headers['sec-fetch-mode'] && { 'Sec-Fetch-Mode': req.headers['sec-fetch-mode'] }),
         ...(req.headers['sec-fetch-dest'] && { 'Sec-Fetch-Dest': req.headers['sec-fetch-dest'] }),
         ...(req.headers['sec-fetch-user'] && { 'Sec-Fetch-User': req.headers['sec-fetch-user'] }),
         // クライアントから送られてきたヘッダーのうち、一部を除く他のヘッダーもコピーします
         ...Object.keys(req.headers).reduce((acc, headerName) => {
             // 除外するヘッダーのリスト
             if (!['host', 'cookie', 'content-type', 'content-length', 'connection', 'user-agent', 'referer', 'accept', 'accept-language', 'upgrade-insecure-requests', 'sec-fetch-site', 'sec-fetch-mode', 'sec-fetch-dest', 'sec-fetch-user'].includes(headerName.toLowerCase())) {
                  acc[headerName] = req.headers[headerName]; // 除外リストにないヘッダーはコピー
             }
             return acc; // 累積オブジェクトを返す
         }, {}) // 初期値は空のオブジェクト
    };

    try {
        console.log(`一般的なURLにアクセスします (GET): ${targetUrl}`); // ログに表示
        // fetchWebPage関数を使って、指定されたURLのコンテンツを取得します（メソッドはGET固定）
        const { data: pageContentBuffer, headers, finalUrl } = await fetchWebPage(targetUrl, 'GET', requestHeaders);
        const contentType = headers['content-type']; // 取得したコンテンツのContent-Typeヘッダーを取得

        // 取得したコンテンツがHTMLの場合
        if (contentType && contentType.includes('text/html')) {
            // decodeContent関数を使って、Bufferデータを文字列（HTMLコード）に変換
            const pageContent = decodeContent(pageContentBuffer, headers);
            // rewriteUrls関数を使って、HTMLコード内のURLをプロキシ経由に書き換え
            const rewrittenHtml = rewriteUrls(pageContent, finalUrl);
            // リダイレクト後の最終的なURLをセッションに保存
            req.session.lastProxiedUrl = finalUrl;
            console.log(`Saved last proxied URL to session: ${finalUrl}`); // 保存したURLをログに表示
            res.setHeader('Content-Type', 'text/html; charset=utf-8'); // 応答ヘッダーをHTML（UTF-8）に設定
            res.send(rewrittenHtml); // 書き換えたHTMLコードをクライアントに送信
        } else if (contentType && contentType.includes('text/css')) {
            // 取得したコンテンツがCSSの場合
            // decodeContent関数を使って、Bufferデータを文字列（CSSコード）に変換
            const pageContent = decodeContent(pageContentBuffer, headers);
            // rewriteCssUrls関数を使って、CSSコード内のURLをプロキシ経由に書き換え
            const rewrittenCss = rewriteCssUrls(pageContent, finalUrl);
            res.setHeader('Content-Type', 'text/css; charset=utf-8'); // 応答ヘッダーをCSS（UTF-8）に設定
            res.send(rewrittenCss); // 書き換えたCSSコードをクライアントに送信
        } else {
            // HTMLでもCSSでもない場合（画像、動画、その他のファイルなど）
            // 取得した元のヘッダー情報をクライアントにそのまま返します（Content-EncodingとContent-Lengthは除く）
            for (const header in headers) {
                 if (header.toLowerCase() === 'content-type') {
                     // Content-Typeヘッダーは、文字コード情報があれば削除し、テキストの場合はUTF-8を追加します
                     const cleanContentType = contentType.replace(/;\s*charset=[^;]+/i, '');
                     if (cleanContentType.startsWith('text/')) {
                          res.setHeader('Content-Type', cleanContentType + '; charset=utf-8');
                     } else {
                          res.setHeader('Content-Type', cleanContentType);
                     }
                 } else if (header.toLowerCase() !== 'content-encoding' && header.toLowerCase() !== 'content-length') {
                     res.setHeader(header, headers[header]); // Content-EncodingとContent-Length以外のヘッダーをそのままコピー
                 }
            }
            res.send(pageContentBuffer); // 取得したコンテンツのBufferデータをそのままクライアントに送信
        }

    } catch (error) {
        // コンテンツ取得や処理中にエラーが発生した場合
        console.error(`処理中にエラーが発生しました (GET): ${error.message}`); // エラーをログに表示
        res.status(500).send(`処理に失敗しました: ${error.message}`); // クライアントにサーバーエラー（500）を伝えます
    }
});


// '/video/:fileName' というアドレスへのGETリクエストを処理する部分です。
// isAuthenticatedミドルウェアが先に実行され、ログインしているユーザーだけがここに到達できます。
// ここで、ダウンロードフォルダに保存されている動画ファイルをクライアントにストリーミング配信します。
// ':fileName' の部分は、実際のリクエストに応じてファイル名（例: /video/abcdef1234567890.webm）が入ります。
app.get('/video/:fileName', isAuthenticated, (req, res) => {
    const fileName = req.params.fileName; // URLの ':fileName' の部分からファイル名を取得します
    const filePath = path.join(downloadsDir, fileName); // ダウンロードフォルダ内のそのファイルの絶対パスを作成します

    // 指定されたファイルの情報（サイズなど）を取得します
    fs.stat(filePath, (err, stat) => {
        if (err) {
            // ファイルが見つからないか、アクセスできない場合
            console.error(`動画ファイルが見つからないか、アクセスできません: ${filePath}`, err); // エラーをログに表示
            return res.status(404).send("動画ファイルが見つかりません"); // クライアントにファイルが見つからない（404）エラーを伝えます
        }

        const fileSize = stat.size; // ファイルサイズを取得
        const range = req.headers.range; // クライアントからのリクエストに「Range」ヘッダーが含まれているか確認します（動画の途中から再生したい場合などに使われます）

        if (range) {
            // Rangeヘッダーが含まれている場合（動画の途中から再生するリクエスト）
            const parts = range.replace(/bytes=/, "").split("-"); // "bytes=start-end" の形式からstartとendを抽出
            const start = parseInt(parts[0], 10); // 開始位置を整数に変換
            const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1; // 終了位置を整数に変換（指定がなければファイルの最後まで）
            const chunkSize = (end - start) + 1; // 送信するデータのサイズ（チャンクサイズ）を計算

            // 指定された範囲のファイルを読み込むためのストリームを作成します
            const fileStream = fs.createReadStream(filePath, { start, end });

            // HTTP応答ヘッダーを設定します。ステータスコードは206（Partial Content: 部分的なコンテンツ）です。
            res.writeHead(206, {
                "Content-Range": `bytes ${start}-${end}/${fileSize}`, // 送信するデータの範囲とファイルサイズ
                "Accept-Ranges": "bytes", // バイト単位での範囲指定を受け付け可能であることを示す
                "Content-Length": chunkSize, // 送信するデータのサイズ
                "Content-Type": "video/webm", // コンテンツの種類はWebM動画
            });

            // ファイルストリームから読み込んだデータを、そのままクライアントへの応答ストリームに流し込みます（パイプ処理）
            fileStream.pipe(res);

            // ストリームの読み込みが完了した場合
            fileStream.on('end', () => {
                console.log('Range stream finished'); // ログに表示
                res.end(); // 応答を終了
            });

            // ストリームの読み込み中にエラーが発生した場合
            fileStream.on('error', (streamErr) => {
                console.error(`ファイルストリームエラー: ${streamErr.message}`); // エラーをログに表示
                res.sendStatus(500); // クライアントにサーバーエラー（500）を伝えます
            });

        } else {
            // Rangeヘッダーが含まれていない場合（動画の最初から再生するリクエスト）
            // ファイル全体を読み込むためのストリームを作成します
            const stream = fs.createReadStream(filePath);
            // HTTP応答ヘッダーを設定します。ステータスコードは200（OK）です。
            res.writeHead(200, {
                "Content-Length": fileSize, // ファイルサイズ全体
                "Content-Type": "video/webm", // コンテンツの種類はWebM動画
                "Accept-Ranges": "bytes", // バイト単位での範囲指定を受け付け可能であることを示す
            });

            // ファイルストリームから読み込んだデータを、そのままクライアントへの応答ストリームに流し込みます
            stream.pipe(res);

            // ストリームの読み込みが完了した場合
            stream.on('end', () => {
                console.log('Full stream finished'); // ログに表示
                res.end(); // 応答を終了
            });

            // ストリームの読み込み中にエラーが発生した場合
            stream.on('error', (streamErr) => {
                console.error(`Stream error: ${streamErr.message}`); // エラーをログに表示
                res.sendStatus(500); // クライアントにサーバーエラー（500）を伝えます
            });
        }
    });
});


// サーバーを起動し、指定したポートでリクエストを受け付けるようにします
app.listen(port, () => {
    // サーバーが起動したことをコンソールに表示します
    console.log(`Proxy server running at http://localhost:${port}/`);
    console.log(`Downloads will be saved in: ${downloadsDir}`); // ダウンロードフォルダの場所を表示
    console.log(`Access the login page at http://localhost:${port}/login`); // ログインページのアドレスを表示
});

// アプリケーションが終了する際に、ダウンロードしたファイルを削除する処理（オプション）
// process.on('exit', cleanup); // アプリケーション終了時にcleanup関数を実行
// process.on('SIGINT', cleanup); // Ctrl+Cなどで強制終了された場合にcleanup関数を実行

// function cleanup() {
//     console.log("Cleaning up downloaded files..."); // クリーンアップ開始メッセージ
//     fs.readdir(downloadsDir, (err, files) => { // ダウンロードフォルダの中のファイル一覧を取得
//         if (err) {
//             console.error("Error reading downloads directory:", err); // ファイル一覧取得エラー
//             return;
//         }
//         for (const file of files) { // ファイルを一つずつ処理
//             const filePath = path.join(downloadsDir, file); // ファイルの絶対パスを作成
//             fs.unlink(filePath, (unlinkErr) => { // ファイルを削除
//                 if (unlinkErr) {
//                     console.error(`Error deleting file ${filePath}:`, unlinkErr); // 削除エラー
//                 } else {
//                     console.log(`Deleted file: ${filePath}`); // 削除成功
//                 }
//             });
//         }
//     });
// }
