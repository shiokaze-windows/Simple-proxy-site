<h1 align="center">シンプルなプロキシサーバーとYouTubeダウンロード機能</h1>

<p align="center">
  これは、Expressを使用して構築されたシンプルなNode.jsプロキシサーバーで、ウェブインターフェースを介してウェブサイトを閲覧したり、YouTubeビデオをダウンロードしたりできます。基本的なパスワード認証が含まれています。
</p>

<br>

<h2>機能</h2>

<ul>
  <li>ウェブサイト閲覧のためのウェブプロキシ</li>
  <li>YouTubeビデオダウンロード機能 (WebM形式)</li>
  <li>基本的なパスワード認証</li>
  <li>ダウンロードされたビデオの一定時間後の自動削除</li>
  <li>プロキシされたHTMLコンテンツ内のURLおよびフォームアクションの書き換え</li>
  <li>CSS URLの書き換え処理</li>
</ul>

<br>

<h2>前提条件</h2>

<p>開始する前に、以下の要件を満たしていることを確認してください。</p>

<ul>
  <li>Node.jsがインストールされていること</li>
  <li>npm (Node package manager) がインストールされていること</li>
  <li>yt-dlpがインストールされ、システムのPATHに含まれていること</li>
  <li>ffmpegがインストールされ、システムのPATHに含まれていること</li>
</ul>

<br>

<h2>インストール</h2>

<ol>
  <li>このリポジトリをクローンします:
    <pre><code>git clone shiokaze-windows/Simple-proxy-site</code></pre>
  </li>
  <li>プロジェクトディレクトリに移動します:
    <pre><code>cd shiokaze-windows/Simple-proxy-site</code></pre>
  </li>
  <li>依存関係をインストールします:
    <pre><code>npm install express axios cheerio cookie-parser express-session crypto fs path util fluent-ffmpeg url iconv-lite qs</code></pre>
  </li>
  <li>yt-dlpとffmpegがインストールされており、ターミナルからアクセスできることを確認してください。</li>
</ol>

<br>

<h2>セットアップ</h2>

<p>認証のためにシークレットパスワードを設定する必要があります。</p>

<ol>
  <li><code>server.js</code> ファイルを開きます。</li>
  <li>以下の行を見つけます:
    <pre><code>const SECRET_PASSWORD = 'パスワード'; // ここを希望するパスワードに設定してください</code></pre>
  </li>


<br>

<h2>使い方</h2>

<ol>
  <li>サーバーを起動します:
    <pre><code>node server.js</code></pre>
  </li>
  <li>ウェブブラウザを開き、<code>http://localhost:3000/login</code> にアクセスします。</li>
  <li>セットアップステップで設定した <code>SECRET_PASSWORD</code> を入力します。</li>
  <li>ログインに成功すると、プロキシとしてアクセスしたいURLまたはダウンロードしたいYouTube URLを入力できるメインページにリダイレクトされます。</li>
</ol>

<h3>ウェブサイトのプロキシ</h3>

<p>アクセスしたいウェブサイトの完全なURLを入力フィールドに入力し、「アクセス」ボタンをクリックします。ウェブサイトがプロキシ経由でロードされます。</p>

<h3>YouTubeビデオのダウンロード</h3>

<p>有効なYouTubeビデオのURLを入力フィールドに入力します。サーバーはビデオをWebM形式でダウンロードし、サーバーから直接ビデオをストリーミングまたはダウンロードするためのURLにリダイレクトされます。</p>

<br>

<h2>重要な注意点</h2>

<ul>
  <li><strong>YouTube動画再生:</strong> YouTube動画再生機能は <code>yt-dlp</code> および <code>ffmpeg</code> に依存しています。それらが正しくインストールおよび設定されていることを確認してください。</li>
  <li><strong>ビデオ削除:</strong> ダウンロードされたビデオは、一定期間後に自動的に削除がスケジュールされます（ビデオの長さの3倍または最大2時間の短い方、長さが判断できない場合はデフォルトで1時間）。</li>
  <li><strong>セッション:</strong> サーバーは認証にセッションを使用します。セッションは1時間で期限切れになるように設定されています。</li>
  <li><strong>HTTP vs HTTPS:</strong> セッションCookieは現在 <code>secure: false</code> に設定されており、HTTP経由で機能します。HTTPSを使用する本番環境にデプロイする場合は、これを <code>secure: true</code> に変更してください。</li>
  <li><strong>エラー処理:</strong> 基本的なエラー処理は含まれていますが、本番環境で使用するには、より堅牢なエラー管理とロギングが必要になります。</li>
</ul>

<br>

<h2>貢献</h2>

<p>このリポジトリをフォークしてプルリクエストを送信することを歓迎します。</p>

<br>

<h2>ライセンス</h2>

<p>このプロジェクトは、<a href="https://opensource.org/licenses/MIT" target="_blank">MITライセンス</a>の下でライセンスされています。これは一般的な「フリーソフトウェアライセンス」の一つであり、コードの利用、複製、改変、配布、販売などを非常に自由に行うことができます。詳細は <a href="LICENSE">LICENSE</a> ファイルを参照してください。</p>
