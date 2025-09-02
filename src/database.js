const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const dbPath = path.join(__dirname, '..', 'data', 'sns_analytics.db');

class Database {
  constructor() {
    this.db = new sqlite3.Database(dbPath);
    this.init();
  }

  init() {
    this.db.serialize(() => {
      // 投稿テーブル（新しいデータモデル対応）
      // 会社情報テーブル
      this.db.run(`
        CREATE TABLE IF NOT EXISTS companies (
          id TEXT PRIMARY KEY,
          company_name TEXT NOT NULL,
          industry TEXT NOT NULL,
          start_date TEXT NOT NULL,
          initial_followers INTEGER DEFAULT 0,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
      `);

      this.db.run(`
        CREATE TABLE IF NOT EXISTS posts_new (
          id TEXT PRIMARY KEY,
          company TEXT NOT NULL DEFAULT 'default',
          date TEXT NOT NULL,
          genre TEXT NOT NULL,
          image_url TEXT,
          likes INTEGER DEFAULT 0,
          saves INTEGER DEFAULT 0,
          new_followers INTEGER DEFAULT 0,
          reach_total INTEGER DEFAULT 0,
          reach_follower INTEGER DEFAULT 0,
          reach_non_follower INTEGER DEFAULT 0,
          eng_follower INTEGER DEFAULT 0,
          eng_non_follower INTEGER DEFAULT 0,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
      `);

      // グリッド投稿用テーブル
      this.db.run(`
        CREATE TABLE IF NOT EXISTS posts_grid (
          id TEXT PRIMARY KEY,
          company TEXT NOT NULL DEFAULT 'default',
          year INTEGER NOT NULL,
          month INTEGER NOT NULL,
          date TEXT NOT NULL,
          post_type TEXT NOT NULL DEFAULT 'フィード',
          genre TEXT NOT NULL,
          image_url TEXT,
          likes INTEGER DEFAULT 0,
          saves INTEGER DEFAULT 0,
          new_followers INTEGER DEFAULT 0,
          reach_total INTEGER DEFAULT 0,
          reach_follower INTEGER DEFAULT 0,
          reach_non_follower INTEGER DEFAULT 0,
          eng_follower INTEGER DEFAULT 0,
          eng_non_follower INTEGER DEFAULT 0,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
      `);

      // 既存テーブルにpost_typeカラムを追加（存在しない場合のみ）
      this.db.run(`
        ALTER TABLE posts_grid ADD COLUMN post_type TEXT DEFAULT 'フィード'
      `, (err) => {
        // カラムが既に存在する場合はエラーが出るが無視する
        if (err && !err.message.includes('duplicate column name')) {
          console.error('post_typeカラム追加エラー:', err);
        }
      });

      // 既存テーブルにtitleカラムを追加（存在しない場合のみ）
      this.db.run(`
        ALTER TABLE posts_grid ADD COLUMN title TEXT DEFAULT ''
      `, (err) => {
        // カラムが既に存在する場合はエラーが出るが無視する
        if (err && !err.message.includes('duplicate column name')) {
          console.error('titleカラム追加エラー:', err);
        }
      });

      // 旧テーブルとの互換性のため、既存テーブルも保持
      this.db.run(`
        CREATE TABLE IF NOT EXISTS posts (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          post_date TEXT NOT NULL,
          post_time TEXT NOT NULL,
          post_type TEXT NOT NULL CHECK(post_type IN ('image', 'reel', 'story')),
          caption TEXT,
          hashtags TEXT,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
      `);

      // パフォーマンステーブル
      this.db.run(`
        CREATE TABLE IF NOT EXISTS performance (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          post_id INTEGER,
          likes INTEGER DEFAULT 0,
          comments INTEGER DEFAULT 0,
          saves INTEGER DEFAULT 0,
          reach INTEGER DEFAULT 0,
          impressions INTEGER DEFAULT 0,
          updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (post_id) REFERENCES posts (id)
        )
      `);

      // クライアントテーブル（複数クライアント対応）
      this.db.run(`
        CREATE TABLE IF NOT EXISTS clients (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          name TEXT NOT NULL,
          instagram_handle TEXT,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
      `);

      // 月次目標テーブル
      this.db.run(`
        CREATE TABLE IF NOT EXISTS monthly_goals (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          company TEXT NOT NULL DEFAULT 'default',
          year INTEGER NOT NULL,
          month INTEGER NOT NULL,
          target_followers INTEGER NOT NULL,
          current_followers INTEGER DEFAULT 0,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          UNIQUE(company, year, month)
        )
      `);

      // 既存テーブルにcompanyカラムを追加（存在しない場合）
      this.db.run(`
        PRAGMA table_info(posts_new)
      `, (err, rows) => {
        if (!err && rows) {
          console.log('posts_newテーブル構造:', rows);
        }
      });

      this.db.run(`
        PRAGMA table_info(monthly_goals)
      `, (err, rows) => {
        if (!err) {
          // companyカラムが存在しない場合は追加
          this.db.run(`
            ALTER TABLE monthly_goals ADD COLUMN company TEXT DEFAULT 'default'
          `, (alterErr) => {
            if (alterErr && !alterErr.message.includes('duplicate column')) {
              console.error('月次目標テーブルの更新エラー:', alterErr);
            } else if (!alterErr) {
              console.log('月次目標テーブルにcompanyカラムを追加しました');
            }
          });
        }
      });

      // companiesテーブルにplanカラムを追加（存在しない場合のみ）
      this.db.run(`
        ALTER TABLE companies ADD COLUMN plan TEXT DEFAULT ''
      `, (err) => {
        // カラムが既に存在する場合はエラーが出るが無視する
        if (err && !err.message.includes('duplicate column name')) {
          console.error('planカラム追加エラー:', err);
        } else if (!err) {
          console.log('companiesテーブルにplanカラムを追加しました');
        }
      });

      // フォロワー数履歴テーブル
      this.db.run(`
        CREATE TABLE IF NOT EXISTS follower_history (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          date TEXT NOT NULL,
          followers_count INTEGER NOT NULL,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          UNIQUE(date)
        )
      `);
    });
  }

  // 投稿データ挿入
  addPost(postData, callback) {
    const { post_date, post_time, post_type, caption, hashtags } = postData;
    this.db.run(
      'INSERT INTO posts (post_date, post_time, post_type, caption, hashtags) VALUES (?, ?, ?, ?, ?)',
      [post_date, post_time, post_type, caption, hashtags],
      callback
    );
  }

  // パフォーマンスデータ挿入
  addPerformance(performanceData, callback) {
    const { post_id, likes, comments, saves, reach, impressions } = performanceData;
    this.db.run(
      'INSERT INTO performance (post_id, likes, comments, saves, reach, impressions) VALUES (?, ?, ?, ?, ?, ?)',
      [post_id, likes, comments, saves, reach, impressions],
      callback
    );
  }

  // 全投稿取得
  getAllPosts(callback) {
    this.db.all(`
      SELECT 
        p.id,
        p.post_date,
        p.post_time,
        p.post_type,
        p.caption,
        p.hashtags,
        perf.likes,
        perf.comments,
        perf.saves,
        perf.reach,
        perf.impressions
      FROM posts p
      LEFT JOIN performance perf ON p.id = perf.post_id
      ORDER BY p.post_date DESC, p.post_time DESC
    `, callback);
  }

  // 月次目標設定または更新
  setMonthlyGoal(goalData, callback) {
    const { company, year, month, target_followers, current_followers } = goalData;
    this.db.run(`
      INSERT OR REPLACE INTO monthly_goals 
      (company, year, month, target_followers, current_followers, updated_at) 
      VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
    `, [company || 'default', year, month, target_followers, current_followers || 0], callback);
  }

  // 現在フォロワー数更新
  updateCurrentFollowers(company, year, month, current_followers, callback) {
    this.db.run(`
      UPDATE monthly_goals 
      SET current_followers = ?, updated_at = CURRENT_TIMESTAMP 
      WHERE company = ? AND year = ? AND month = ?
    `, [current_followers, company || 'default', year, month], callback);
  }

  // 月次目標取得
  getMonthlyGoal(company, year, month, callback) {
    this.db.get(`
      SELECT * FROM monthly_goals 
      WHERE company = ? AND year = ? AND month = ?
    `, [company || 'default', year, month], callback);
  }

  // 現在の月の目標取得
  getCurrentMonthGoal(company, callback) {
    const now = new Date();
    const year = now.getFullYear();
    const month = now.getMonth() + 1;
    this.getMonthlyGoal(company || 'default', year, month, callback);
  }

  // 全ての月次目標取得
  getAllMonthlyGoals(company, callback) {
    if (typeof company === 'function') {
      // companyが省略された場合（後方互換性のため）
      callback = company;
      this.db.all(`
        SELECT * FROM monthly_goals 
        ORDER BY year DESC, month DESC
      `, callback);
    } else {
      this.db.all(`
        SELECT * FROM monthly_goals 
        WHERE company = ?
        ORDER BY year DESC, month DESC
      `, [company], callback);
    }
  }

  // 月次レポート用データ取得
  getMonthlyReportData(year, month, callback) {
    this.db.all(`
      SELECT 
        p.id,
        p.post_date,
        p.post_time,
        p.post_type,
        p.caption,
        p.hashtags,
        perf.likes,
        perf.comments,
        perf.saves,
        perf.reach,
        perf.impressions
      FROM posts p
      LEFT JOIN performance perf ON p.id = perf.post_id
      WHERE substr(p.post_date, 1, 4) = ? 
        AND substr(p.post_date, 6, 2) = ?
      ORDER BY p.post_date ASC, p.post_time ASC
    `, [year.toString(), month.toString().padStart(2, '0')], callback);
  }

  // ハッシュタグ分析データ取得
  getHashtagAnalysis(callback) {
    this.db.all(`
      SELECT 
        p.hashtags,
        AVG(perf.likes) as avg_likes,
        AVG(perf.comments) as avg_comments,
        AVG(perf.saves) as avg_saves,
        COUNT(*) as usage_count
      FROM posts p
      LEFT JOIN performance perf ON p.id = perf.post_id
      WHERE p.hashtags IS NOT NULL AND p.hashtags != ''
      GROUP BY p.hashtags
      ORDER BY avg_likes DESC
    `, callback);
  }

  // フォロワー数履歴追加・更新
  addFollowerHistory(date, followers_count, callback) {
    this.db.run(
      'INSERT OR REPLACE INTO follower_history (date, followers_count) VALUES (?, ?)',
      [date, followers_count],
      callback
    );
  }

  // フォロワー数履歴取得（期間指定）
  getFollowerHistory(startDate, endDate, callback) {
    this.db.all(`
      SELECT * FROM follower_history 
      WHERE date BETWEEN ? AND ? 
      ORDER BY date ASC
    `, [startDate, endDate], callback);
  }

  // 月次フォロワー履歴取得
  getMonthlyFollowerHistory(year, month, callback) {
    const startDate = `${year}-${month.toString().padStart(2, '0')}-01`;
    const endDate = `${year}-${month.toString().padStart(2, '0')}-31`;
    this.getFollowerHistory(startDate, endDate, callback);
  }

  // 全フォロワー履歴取得（最新30日）
  getRecentFollowerHistory(callback) {
    this.db.all(`
      SELECT * FROM follower_history 
      ORDER BY date DESC 
      LIMIT 30
    `, callback);
  }

  // 新しい投稿データ挿入・更新
  upsertPostNew(postData, callback) {
    const { id, company, date, genre, image_url, likes, saves, new_followers, reach_total, reach_follower, reach_non_follower, eng_follower, eng_non_follower } = postData;
    this.db.run(`
      INSERT OR REPLACE INTO posts_new 
      (id, company, date, genre, image_url, likes, saves, new_followers, reach_total, reach_follower, reach_non_follower, eng_follower, eng_non_follower, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
    `, [id, company || 'default', date, genre, image_url, likes, saves, new_followers || 0, reach_total, reach_follower, reach_non_follower, eng_follower, eng_non_follower], callback);
  }

  // 複数投稿を一括保存
  saveBulkPosts(postsArray, callback) {
    console.log('saveBulkPosts開始:', postsArray.length, '件のデータ');
    
    this.db.serialize(() => {
      this.db.run("BEGIN TRANSACTION");
      
      let completed = 0;
      const total = postsArray.length;
      let hasError = false;
      
      if (total === 0) {
        this.db.run("COMMIT");
        callback(null);
        return;
      }
      
      postsArray.forEach((post, index) => {
        console.log(`投稿 ${index + 1}/${total} 保存中:`, post.id);
        this.upsertPostNew(post, (err) => {
          if (err && !hasError) {
            hasError = true;
            console.error('投稿保存エラー:', err, 'データ:', post);
            this.db.run("ROLLBACK");
            callback(err);
            return;
          }
          
          completed++;
          console.log(`投稿 ${index + 1} 完了 (${completed}/${total})`);
          
          if (completed === total && !hasError) {
            console.log('全投稿保存完了、コミット中');
            this.db.run("COMMIT");
            callback(null);
          }
        });
      });
    });
  }

  // 新しい投稿データ全取得
  getAllPostsNew(company, callback) {
    if (typeof company === 'function') {
      // company が省略された場合（後方互換性のため）
      callback = company;
      this.db.all(`
        SELECT * FROM posts_new 
        ORDER BY date DESC
      `, callback);
    } else {
      this.db.all(`
        SELECT * FROM posts_new 
        WHERE company = ?
        ORDER BY date DESC
      `, [company], callback);
    }
  }

  // 月次投稿データ取得（新）
  getMonthlyPostsNew(year, month, company, callback) {
    console.log(`月別投稿データ取得: ${year}年${month}月, 企業: ${company}`);
    this.db.all(`
      SELECT * FROM posts_grid 
      WHERE year = ? AND month = ? AND company = ?
      ORDER BY date ASC
    `, [year, month, company || 'default'], (err, posts) => {
      if (err) {
        console.error('月別投稿データ取得エラー:', err);
        return callback(err);
      }
      console.log(`取得した投稿数: ${posts ? posts.length : 0}件`);
      if (posts && posts.length > 0) {
        console.log('投稿データの例:', posts[0]);
      }
      callback(null, posts);
    });
  }

  // 投稿削除
  deletePost(postId, callback) {
    this.db.run(`
      DELETE FROM posts_new WHERE id = ?
    `, [postId], callback);
  }

  // 会社情報登録
  addCompany(companyData, callback) {
    this.db.run(`
      INSERT INTO companies (id, company_name, industry, start_date, initial_followers, plan)
      VALUES (?, ?, ?, ?, ?, ?)
    `, [companyData.id, companyData.company_name, companyData.industry, companyData.start_date, companyData.initial_followers, companyData.plan || ''], callback);
  }

  // 会社情報取得
  getCompany(companyId, callback) {
    this.db.get(`
      SELECT * FROM companies WHERE id = ?
    `, [companyId], callback);
  }

  // 全会社情報取得
  getAllCompanies(callback) {
    this.db.all(`
      SELECT * FROM companies ORDER BY created_at ASC
    `, callback);
  }

  // 会社情報更新
  updateCompany(companyId, companyData, callback) {
    this.db.run(`
      UPDATE companies 
      SET company_name = ?, industry = ?, start_date = ?, initial_followers = ?, plan = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `, [companyData.company_name, companyData.industry, companyData.start_date, companyData.initial_followers, companyData.plan || '', companyId], callback);
  }

  // 企業ID更新
  updateCompanyId(currentId, newId, callback) {
    this.db.serialize(() => {
      this.db.run('BEGIN TRANSACTION');
      
      // 企業テーブルのIDを更新
      this.db.run(`UPDATE companies SET id = ? WHERE id = ?`, [newId, currentId], (err) => {
        if (err) {
          this.db.run('ROLLBACK');
          return callback(err);
        }
        
        // 関連テーブルも更新
        this.db.run(`UPDATE posts_grid SET company = ? WHERE company = ?`, [newId, currentId], (err) => {
          if (err) {
            this.db.run('ROLLBACK');
            return callback(err);
          }
          
          this.db.run(`UPDATE monthly_goals SET company = ? WHERE company = ?`, [newId, currentId], (err) => {
            if (err) {
              this.db.run('ROLLBACK');
              return callback(err);
            }
            
            this.db.run('COMMIT', callback);
          });
        });
      });
    });
  }

  // 会社削除
  deleteCompany(companyId, callback) {
    this.db.serialize(() => {
      // 関連する投稿データも削除
      this.db.run(`DELETE FROM posts_new WHERE company = ?`, [companyId]);
      this.db.run(`DELETE FROM companies WHERE id = ?`, [companyId], callback);
    });
  }

  // グリッド投稿データ一括保存（新）
  saveBulkPostsGrid(postsArray, callback) {
    console.log('saveBulkPostsGrid開始:', postsArray.length, '件のデータ');
    
    this.db.serialize(() => {
      this.db.run("BEGIN TRANSACTION");
      
      let completed = 0;
      const total = postsArray.length;
      let hasError = false;
      
      if (total === 0) {
        this.db.run("COMMIT");
        callback(null);
        return;
      }
      
      postsArray.forEach((post, index) => {
        const year = new Date(post.date).getFullYear();
        const month = new Date(post.date).getMonth() + 1;
        
        console.log(`グリッド投稿 ${index + 1}/${total} 保存中:`, post.id);
        this.db.run(`
          INSERT OR REPLACE INTO posts_grid 
          (id, title, company, year, month, date, post_type, genre, image_url, likes, saves, new_followers, reach_total, reach_follower, reach_non_follower, eng_follower, eng_non_follower, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
        `, [
          post.id, 
          post.title || '', 
          post.company || 'default', 
          year, 
          month, 
          post.date, 
          post.postType || 'フィード',
          post.genre, 
          post.imageUrl || '', 
          post.likes || 0, 
          post.saves || 0, 
          post.newFollowers || 0, 
          post.reachTotal || 0, 
          post.reachFollower || 0, 
          post.reachNonFollower || 0, 
          post.engFollower || 0, 
          post.engNonFollower || 0
        ], (err) => {
          if (err && !hasError) {
            hasError = true;
            console.error('グリッド投稿保存エラー:', err, 'データ:', post);
            this.db.run("ROLLBACK");
            callback(err);
            return;
          }
          
          completed++;
          console.log(`グリッド投稿 ${index + 1} 完了 (${completed}/${total})`);
          
          if (completed === total && !hasError) {
            console.log('全グリッド投稿保存完了、コミット中');
            this.db.run("COMMIT");
            callback(null);
          }
        });
      });
    });
  }

  // グリッド投稿削除
  deletePostGrid(postId, callback) {
    this.db.run(`
      DELETE FROM posts_grid WHERE id = ?
    `, [postId], callback);
  }

  close() {
    this.db.close();
  }
}

module.exports = Database;