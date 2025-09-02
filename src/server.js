const express = require('express');
const path = require('path');
const Database = require('./database');

const app = express();
const port = 3000;
const db = new Database();

// ミドルウェア設定
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, '..', 'public')));

// EJSテンプレートエンジン設定
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, '..', 'views'));

// ルート - メインページ（会社選択画面）
app.get('/', (req, res) => {
  db.getAllCompanies((err, companies) => {
    if (err) {
      console.error(err);
      return res.status(500).send('データベースエラー');
    }
    res.render('index', { companies });
  });
});




// ルート - 目標設定画面
app.get('/goals', (req, res) => {
  const company = req.query.company || 'default';
  
  db.getCurrentMonthGoal(company, (err, currentGoal) => {
    if (err) {
      console.error(err);
    }
    
    db.getAllCompanies((companyErr, companies) => {
      if (companyErr) {
        console.error(companyErr);
      }
      
      // 企業情報を取得してフォロワー数を計算
      db.getCompany(company, (getCompanyErr, companyData) => {
        if (getCompanyErr || !companyData) {
          res.render('goals', { currentGoal, company, companies: companies || [] });
          return;
        }
        
        // 投稿データから新しいフォロワー数を集計
        db.getAllPostsNew(company, (postsErr, posts) => {
          let calculatedCurrentFollowers = companyData.initial_followers || 0;
          
          if (!postsErr && posts && posts.length > 0) {
            const totalNewFollowers = posts.reduce((sum, post) => {
              return sum + (parseInt(post.new_followers) || 0);
            }, 0);
            
            calculatedCurrentFollowers = companyData.initial_followers + totalNewFollowers;
          }
          
          // 目標データに計算したフォロワー数を反映
          const updatedGoal = currentGoal ? {
            ...currentGoal,
            current_followers: calculatedCurrentFollowers
          } : null;
          
          res.render('goals', { currentGoal: updatedGoal, company, companies: companies || [] });
        });
      });
    });
  });
});

// ルート - 目標設定/更新
app.post('/goals', (req, res) => {
  const now = new Date();
  const company = req.body.company || 'default';
  const year = parseInt(req.body.year) || now.getFullYear();
  const month = parseInt(req.body.month) || (now.getMonth() + 1);
  
  // 企業情報と投稿データから現在フォロワー数を自動計算
  db.getCompany(company, (companyErr, companyData) => {
    if (companyErr || !companyData) {
      return res.status(500).send('企業情報の取得に失敗しました');
    }
    
    db.getAllPostsNew(company, (postsErr, posts) => {
      let calculatedCurrentFollowers = companyData.initial_followers || 0;
      
      if (!postsErr && posts && posts.length > 0) {
        const totalNewFollowers = posts.reduce((sum, post) => {
          return sum + (parseInt(post.new_followers) || 0);
        }, 0);
        
        calculatedCurrentFollowers = companyData.initial_followers + totalNewFollowers;
      }
      
      const goalData = {
        company: company,
        year: year,
        month: month,
        target_followers: parseInt(req.body.target_followers),
        current_followers: calculatedCurrentFollowers // 自動計算された値を使用
      };

      console.log('目標設定データ（自動計算フォロワー数含む）:', goalData);

      db.setMonthlyGoal(goalData, (err) => {
        if (err) {
          console.error('目標設定エラー:', err);
          return res.status(500).send('目標データの保存に失敗しました');
        }
        console.log('目標設定完了、リダイレクト先:', `/goals?company=${company}`);
        res.redirect(`/goals?company=${company}`);
      });
    });
  });
});

// ルート - フォロワー数更新
app.post('/update-followers', (req, res) => {
  const now = new Date();
  const company = req.body.company || 'default';
  const year = now.getFullYear();
  const month = now.getMonth() + 1;
  const current_followers = parseInt(req.body.current_followers);

  db.updateCurrentFollowers(company, year, month, current_followers, (err) => {
    if (err) {
      console.error(err);
      return res.status(500).send('フォロワー数の更新に失敗しました');
    }
    res.redirect(`/goals?company=${company}`);
  });
});

// ルート - 分析ページ
app.get('/analytics', (req, res) => {
  const company = req.query.company || 'default';
  const year = parseInt(req.query.year) || new Date().getFullYear();
  const month = parseInt(req.query.month) || (new Date().getMonth() + 1);
  
  // 月別データを取得
  db.getMonthlyPostsNew(year, month, company, (err, posts) => {
    if (err) {
      console.error(err);
      return res.status(500).send('データベースエラー');
    }
    res.render('analytics', { posts, company, year, month });
  });
});

// API - グラフデータ取得
app.get('/api/analytics-data', (req, res) => {
  const company = req.query.company || 'default';
  const year = parseInt(req.query.year) || new Date().getFullYear();
  const month = parseInt(req.query.month) || (new Date().getMonth() + 1);
  
  // 月別データを取得
  db.getMonthlyPostsNew(year, month, company, (err, posts) => {
    if (err) {
      console.error(err);
      return res.status(500).json({ error: 'データベースエラー' });
    }
    
    // データを分析用に変換
    const analyticsData = processAnalyticsDataNew(posts);
    res.json(analyticsData);
  });
});

// 新しいデータ形式用分析データ処理関数
function processAnalyticsDataNew(posts) {
  console.log('分析データ処理開始 - 投稿数:', posts ? posts.length : 0);
  if (posts && posts.length > 0) {
    console.log('投稿データのジャンル:', posts.map(p => p.genre).join(', '));
  }
  
  if (!posts || posts.length === 0) {
    return {
      likesOverTime: { labels: [], data: [] },
      genreComparison: { labels: [], data: [] },
      reachAnalysis: { labels: [], data: [] },
      engagementAnalysis: { labels: [], data: [] }
    };
  }

  // 1. いいね数推移データ
  const likesOverTime = {
    labels: posts.slice(-30).map(post => {
      const date = new Date(post.date);
      const dateStr = `${date.getMonth() + 1}/${date.getDate()}`;
      const title = post.title || `投稿`;
      return `${dateStr}\n${title}`;
    }),
    data: posts.slice(-30).map(post => post.likes || 0)
  };

  // 2. ジャンル別データ
  const genreStats = {};
  posts.forEach(post => {
    if (!genreStats[post.genre]) {
      genreStats[post.genre] = { count: 0, totalLikes: 0, totalSaves: 0, totalReach: 0 };
    }
    genreStats[post.genre].count++;
    genreStats[post.genre].totalLikes += (post.likes || 0);
    genreStats[post.genre].totalSaves += (post.saves || 0);
    genreStats[post.genre].totalReach += (post.reach_total || 0);
  });
  
  console.log('ジャンル別統計:', genreStats);

  const genreComparison = {
    labels: Object.keys(genreStats),
    avgLikes: Object.values(genreStats).map(stat => 
      stat.count > 0 ? Math.round(stat.totalLikes / stat.count) : 0
    ),
    avgSaves: Object.values(genreStats).map(stat => 
      stat.count > 0 ? Math.round(stat.totalSaves / stat.count) : 0
    ),
    avgReach: Object.values(genreStats).map(stat => 
      stat.count > 0 ? Math.round(stat.totalReach / stat.count) : 0
    )
  };
  
  console.log('ジャンル別比較データ:', genreComparison);

  // 3. リーチ分析データ（フォロワー vs 非フォロワー）
  const reachAnalysis = {
    labels: posts.slice(-15).map(post => {
      const date = new Date(post.date);
      const dateStr = `${date.getMonth() + 1}/${date.getDate()}`;
      const title = post.title || `投稿`;
      return `${dateStr}\n${title}`;
    }),
    followerReach: posts.slice(-15).map(post => post.reach_follower || 0),
    nonFollowerReach: posts.slice(-15).map(post => post.reach_non_follower || 0)
  };

  // 4. エンゲージメント分析データ
  const engagementAnalysis = {
    labels: posts.slice(-15).map(post => {
      const date = new Date(post.date);
      const dateStr = `${date.getMonth() + 1}/${date.getDate()}`;
      const title = post.title || `投稿`;
      return `${dateStr}\n${title}`;
    }),
    followerEng: posts.slice(-15).map(post => post.eng_follower || 0),
    nonFollowerEng: posts.slice(-15).map(post => post.eng_non_follower || 0),
    totalEng: posts.slice(-15).map(post => (post.eng_follower || 0) + (post.eng_non_follower || 0))
  };

  return {
    likesOverTime,
    genreComparison,
    reachAnalysis,
    engagementAnalysis
  };
}

// 旧形式データ用分析データ処理関数（互換性のため保持）
function processAnalyticsData(posts) {
  if (!posts || posts.length === 0) {
    return {
      likesOverTime: { labels: [], data: [] },
      postTypeComparison: { labels: [], data: [] },
      timeAnalysis: { labels: [], data: [] }
    };
  }

  // 1. いいね数推移データ
  const likesOverTime = {
    labels: posts.slice(-30).map(post => `${post.post_date}`),
    data: posts.slice(-30).map(post => post.likes || 0)
  };

  // 2. 投稿タイプ別データ
  const postTypeStats = {};
  posts.forEach(post => {
    if (!postTypeStats[post.post_type]) {
      postTypeStats[post.post_type] = { count: 0, totalLikes: 0, totalEngagement: 0 };
    }
    postTypeStats[post.post_type].count++;
    postTypeStats[post.post_type].totalLikes += (post.likes || 0);
    postTypeStats[post.post_type].totalEngagement += (post.likes || 0) + (post.comments || 0) + (post.saves || 0);
  });

  const postTypeComparison = {
    labels: Object.keys(postTypeStats).map(type => 
      type === 'image' ? '画像' : type === 'reel' ? 'リール' : 'ストーリー'
    ),
    avgLikes: Object.values(postTypeStats).map(stat => 
      stat.count > 0 ? Math.round(stat.totalLikes / stat.count) : 0
    ),
    avgEngagement: Object.values(postTypeStats).map(stat => 
      stat.count > 0 ? Math.round(stat.totalEngagement / stat.count) : 0
    )
  };

  // 3. 時間帯分析データ
  const timeStats = {};
  posts.forEach(post => {
    const hour = parseInt(post.post_time.split(':')[0]);
    if (!timeStats[hour]) {
      timeStats[hour] = { count: 0, totalEngagement: 0 };
    }
    timeStats[hour].count++;
    timeStats[hour].totalEngagement += (post.likes || 0) + (post.comments || 0) + (post.saves || 0);
  });

  const timeAnalysis = {
    labels: Array.from({ length: 24 }, (_, i) => `${i}時`),
    data: Array.from({ length: 24 }, (_, i) => 
      timeStats[i] ? Math.round(timeStats[i].totalEngagement / timeStats[i].count) : 0
    )
  };

  return {
    likesOverTime,
    postTypeComparison,
    timeAnalysis
  };
}

// フォロワーチャートデータ処理関数
function processFollowerChartData(history) {
  if (!history || history.length === 0) {
    return {
      followerGrowth: { labels: [], totalFollowers: [], weeklyGrowth: [] },
      weeklyGrowthData: { labels: [], data: [] }
    };
  }

  // 日付順にソート
  const sortedHistory = history.sort((a, b) => new Date(a.date) - new Date(b.date));
  
  // 全体のフォロワー数推移データ
  const followerGrowth = {
    labels: sortedHistory.map(h => {
      const date = new Date(h.date);
      return `${date.getMonth() + 1}/${date.getDate()}`;
    }),
    totalFollowers: sortedHistory.map(h => h.followers_count),
    weeklyGrowth: []
  };

  // 週次増加数計算
  const weeklyData = [];
  for (let i = 0; i < sortedHistory.length; i += 7) {
    const weekStart = sortedHistory[i];
    const weekEnd = sortedHistory[Math.min(i + 6, sortedHistory.length - 1)];
    
    if (weekStart && weekEnd) {
      const startDate = new Date(weekStart.date);
      const endDate = new Date(weekEnd.date);
      const growth = weekEnd.followers_count - weekStart.followers_count;
      
      weeklyData.push({
        week: `${startDate.getMonth() + 1}/${startDate.getDate()}-${endDate.getMonth() + 1}/${endDate.getDate()}`,
        growth: growth
      });
      
      followerGrowth.weeklyGrowth.push(growth);
    }
  }

  const weeklyGrowthData = {
    labels: weeklyData.map(w => w.week),
    data: weeklyData.map(w => w.growth)
  };

  return {
    followerGrowth,
    weeklyGrowthData
  };
}

// ルート - 会社管理ページ
app.get('/companies', (req, res) => {
  db.getAllCompanies((err, companies) => {
    if (err) {
      console.error(err);
      return res.status(500).send('データベースエラー');
    }
    res.render('companies', { companies });
  });
});

// ルート - 会社登録フォーム
app.get('/companies/add', (req, res) => {
  res.render('company-form', { company: null, isEdit: false });
});

// ルート - 会社詳細画面
app.get('/companies/:id', (req, res) => {
  const companyId = req.params.id;
  const year = parseInt(req.query.year) || new Date().getFullYear();
  const month = parseInt(req.query.month) || (new Date().getMonth() + 1);
  
  db.getCompany(companyId, (err, company) => {
    if (err) {
      console.error(err);
      return res.status(500).send('データベースエラー');
    }
    if (!company) {
      return res.status(404).send('会社が見つかりません');
    }
    
    // 指定された月の目標を取得
    db.getMonthlyGoal(companyId, year, month, (goalErr, currentGoal) => {
      if (goalErr) {
        console.error('目標取得エラー:', goalErr);
      }
      
      // 指定された月の投稿データから新しいフォロワー数を集計
      db.getMonthlyPostsNew(year, month, companyId, (postsErr, posts) => {
        console.log(`企業 ${companyId} の${year}年${month}月投稿データ取得結果:`, postsErr, posts ? posts.length : 'null');
        
        let calculatedCurrentFollowers = company.initial_followers || 0;
        
        // 全投稿データを取得してトータルフォロワー数を計算
        db.getAllPostsNew(companyId, (allPostsErr, allPosts) => {
          if (!allPostsErr && allPosts && allPosts.length > 0) {
            // 全ての月の新しいフォロワー数を合計
            const totalNewFollowers = allPosts.reduce((sum, post) => {
              const followers = parseInt(post.new_followers) || 0;
              return sum + followers;
            }, 0);
            
            calculatedCurrentFollowers = company.initial_followers + totalNewFollowers;
            
            console.log(`企業 ${companyId}: 全期間トータル - 開始時フォロワー ${company.initial_followers}, 新規フォロワー合計 ${totalNewFollowers}, トータルフォロワー ${calculatedCurrentFollowers}`);
          }
          
          // その月のみの新しいフォロワー数を計算（目標達成率用）
          let monthlyNewFollowers = 0;
          if (!postsErr && posts && posts.length > 0) {
            monthlyNewFollowers = posts.reduce((sum, post) => {
              return sum + (parseInt(post.new_followers) || 0);
            }, 0);
          }
          
          // 目標達成率はその月のフォロワー数で計算
          const monthlyCurrentFollowers = company.initial_followers + monthlyNewFollowers;
          
          // 目標データに計算したフォロワー数を反映
          const updatedGoal = currentGoal ? {
            ...currentGoal,
            current_followers: monthlyCurrentFollowers  // その月のフォロワー数で目標達成率計算
          } : null;
          
          console.log(`企業 ${companyId}: ${year}年${month}月 - その月の新規フォロワー ${monthlyNewFollowers}, 月末フォロワー ${monthlyCurrentFollowers}`);
          
          res.render('company-detail', { 
            company, 
            currentGoal: updatedGoal, 
            year, 
            month,
            calculatedCurrentFollowers 
          });
        });
      });
    });
  });
});

// ルート - 会社編集フォーム
app.get('/companies/edit/:id', (req, res) => {
  const companyId = req.params.id;
  db.getCompany(companyId, (err, company) => {
    if (err) {
      console.error(err);
      return res.status(500).send('データベースエラー');
    }
    if (!company) {
      return res.status(404).send('会社が見つかりません');
    }
    res.render('company-form', { company, isEdit: true });
  });
});

// ルート - 会社登録処理
app.post('/companies', (req, res) => {
  const companyData = {
    id: 'company_' + Date.now(),
    company_name: req.body.company_name,
    industry: req.body.industry,
    start_date: req.body.start_date,
    initial_followers: parseInt(req.body.initial_followers) || 0,
    plan: req.body.plan
  };
  
  db.addCompany(companyData, (err) => {
    if (err) {
      console.error(err);
      return res.status(500).send('会社情報の登録に失敗しました');
    }
    res.redirect('/companies');
  });
});

// ルート - 会社情報更新
app.post('/companies/:id', (req, res) => {
  const companyId = req.params.id;
  const companyData = {
    company_name: req.body.company_name,
    industry: req.body.industry,
    start_date: req.body.start_date,
    initial_followers: parseInt(req.body.initial_followers) || 0,
    plan: req.body.plan
  };
  
  db.updateCompany(companyId, companyData, (err) => {
    if (err) {
      console.error(err);
      return res.status(500).send('会社情報の更新に失敗しました');
    }
    res.redirect('/companies');
  });
});

// ルート - 会社削除
app.delete('/companies/:id', (req, res) => {
  const companyId = req.params.id;
  
  db.deleteCompany(companyId, (err) => {
    if (err) {
      console.error(err);
      return res.status(500).json({ error: '会社の削除に失敗しました' });
    }
    res.json({ success: true, message: '会社を削除しました' });
  });
});

// API - 会社一覧取得
app.get('/api/companies', (req, res) => {
  db.getAllCompanies((err, companies) => {
    if (err) {
      console.error(err);
      return res.status(500).json({ error: 'データベースエラー' });
    }
    res.json(companies);
  });
});

// API - 企業ID更新
app.put('/api/companies/:id/update-id', (req, res) => {
  const currentId = req.params.id;
  const { newId } = req.body;
  
  if (!newId || newId.trim() === '') {
    return res.status(400).json({ error: '新しいIDを指定してください' });
  }
  
  const trimmedNewId = newId.trim();
  
  if (trimmedNewId === currentId) {
    return res.json({ message: '変更はありません' });
  }
  
  // 新しいIDが既に存在するかチェック
  db.getCompany(trimmedNewId, (err, existingCompany) => {
    if (err) {
      console.error(err);
      return res.status(500).json({ error: 'データベースエラー' });
    }
    
    if (existingCompany) {
      return res.status(400).json({ error: 'このIDは既に使用されています' });
    }
    
    // 企業IDを更新
    db.updateCompanyId(currentId, trimmedNewId, (err) => {
      if (err) {
        console.error(err);
        return res.status(500).json({ error: '企業ID更新に失敗しました' });
      }
      
      res.json({ message: '企業IDを更新しました', newId: trimmedNewId });
    });
  });
});

// ルート - グリッド形式投稿入力ページ
app.get('/add-post-grid', (req, res) => {
  const year = parseInt(req.query.year) || new Date().getFullYear();
  const month = parseInt(req.query.month) || (new Date().getMonth() + 1);
  const company = req.query.company || 'default';
  res.render('add-post-grid', { year, month, company });
});

// API - グリッドデータ保存
app.post('/api/posts-grid', async (req, res) => {
  const postsData = req.body;
  
  console.log('受信したデータ:', JSON.stringify(postsData, null, 2)); // デバッグログ
  
  if (!Array.isArray(postsData) || postsData.length === 0) {
    return res.status(400).json({ error: '不正なデータ形式です' });
  }
  
  // データの検証と変換
  const company = postsData[0]?.company || req.query.company || 'default';
  console.log('データ保存処理 - 企業:', company, '投稿数:', postsData.length);
  
  if (!company || company === '') {
    return res.status(400).json({ error: '企業IDが指定されていません' });
  }

  // 企業の存在確認（defaultは例外）
  if (company !== 'default') {
    const companyExists = await new Promise((resolve) => {
      db.getCompany(company, (err, companyData) => {
        resolve(!err && companyData);
      });
    });
    
    if (!companyExists) {
      return res.status(400).json({ error: '指定された企業が見つかりません' });
    }
  }
  
  const processedPosts = postsData.map(post => {
    const processed = {
      id: post.id || 'post_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9),
      title: post.title || '',
      company: post.company || company,
      date: post.date || new Date().toISOString().split('T')[0],
      postType: post.postType || 'フィード',
      genre: post.genre || '人物',
      imageUrl: post.imageUrl || '',
      likes: parseInt(post.likes) || 0,
      saves: parseInt(post.saves) || 0,
      newFollowers: parseInt(post.newFollowers) || 0,
      reachTotal: parseInt(post.reachTotal) || 0,
      reachFollower: parseInt(post.reachFollower) || 0,
      reachNonFollower: parseInt(post.reachNonFollower) || 0,
      engFollower: parseInt(post.engFollower) || 0,
      engNonFollower: parseInt(post.engNonFollower) || 0
    };
    
    return processed;
  });

  // 同じ月の既存データを削除してから新しいデータを保存
  const sampleDate = processedPosts[0].date;
  const year = sampleDate.split('-')[0];
  const month = sampleDate.split('-')[1];
  
  console.log(`同じ月(${year}-${month})の既存データを削除中...`);
  
  db.getMonthlyPostsNew(year, month, company, (err, existingPosts) => {
    if (err) {
      console.error('既存データ取得エラー:', err);
      return res.status(500).json({ error: '既存データの確認に失敗しました' });
    }
    
    // 既存データがある場合は削除
    if (existingPosts && existingPosts.length > 0) {
      console.log(`既存の${existingPosts.length}件のデータを削除中...`);
      
      let deleteCount = 0;
      const totalToDelete = existingPosts.length;
      
      if (totalToDelete === 0) {
        // 削除するデータがない場合は直接保存
        savePosts();
        return;
      }
      
      existingPosts.forEach(post => {
        db.deletePostGrid(post.id, (deleteErr) => {
          if (deleteErr) {
            console.error('削除エラー:', deleteErr);
          }
          deleteCount++;
          
          if (deleteCount === totalToDelete) {
            console.log(`${deleteCount}件の既存データを削除完了`);
            savePosts();
          }
        });
      });
    } else {
      // 既存データがない場合は直接保存
      savePosts();
    }
  });
  
  function savePosts() {
    db.saveBulkPostsGrid(processedPosts, (err) => {
      if (err) {
        console.error(err);
        return res.status(500).json({ error: 'データの保存に失敗しました' });
      }
      
      // 保存後に確認のためデータを取得
      db.getAllPostsNew(company, (checkErr, checkPosts) => {
        console.log(`保存確認 - 企業 ${company} の投稿データ数: ${checkPosts ? checkPosts.length : 0}`);
        if (checkPosts && checkPosts.length > 0) {
          const totalNewFollowers = checkPosts.reduce((sum, post) => sum + (parseInt(post.new_followers) || 0), 0);
          console.log(`保存確認 - 新しいフォロワー合計: ${totalNewFollowers}`);
        }
      });
      
      res.json({ success: true, message: '投稿データが保存されました', count: processedPosts.length });
    });
  }
});

// API - グリッドデータ取得（月別・会社別）
app.get('/api/posts-grid', (req, res) => {
  const year = parseInt(req.query.year) || new Date().getFullYear();
  const month = parseInt(req.query.month) || (new Date().getMonth() + 1);
  const company = req.query.company || 'default';
  
  console.log('データ取得処理 - 企業:', company, '年月:', year, month);
  
  if (!company || company === '') {
    return res.status(400).json({ error: '企業IDが指定されていません' });
  }
  
  db.getMonthlyPostsNew(year, month, company, (err, posts) => {
    if (err) {
      console.error(err);
      return res.status(500).json({ error: 'データベースエラー' });
    }
    
    // フロントエンド用の形式に変換
    const formattedPosts = posts.map(post => ({
      id: post.id,
      title: post.title || '',
      company: post.company,
      date: post.date,
      postType: post.post_type || 'フィード',
      genre: post.genre,
      imageUrl: post.image_url,
      likes: post.likes,
      saves: post.saves,
      newFollowers: post.new_followers,
      reachTotal: post.reach_total,
      reachFollower: post.reach_follower,
      reachNonFollower: post.reach_non_follower,
      engFollower: post.eng_follower,
      engNonFollower: post.eng_non_follower,
      engTotal: post.eng_follower + post.eng_non_follower
    }));
    
    res.json(formattedPosts);
  });
});

// API - 投稿削除
app.delete('/api/posts-grid/:id', (req, res) => {
  const postId = req.params.id;
  
  db.deletePostGrid(postId, function(err) {
    if (err) {
      console.error(err);
      return res.status(500).json({ error: 'データベースエラー' });
    }
    
    res.json({ success: true, message: '投稿を削除しました' });
  });
});

// ルート - 月次レポートページ（新）
app.get('/report/:companyId', (req, res) => {
  const companyId = req.params.companyId;
  const year = parseInt(req.query.year) || new Date().getFullYear();
  const month = parseInt(req.query.month) || (new Date().getMonth() + 1);

  db.getCompany(companyId, (err, company) => {
    if (err || !company) {
      return res.status(404).send('企業が見つかりません');
    }

    res.render('report', { 
      company,
      year, 
      month 
    });
  });
});

// ルート - 月次レポートページ
app.get('/reports', (req, res) => {
  const now = new Date();
  const year = parseInt(req.query.year) || now.getFullYear();
  const month = parseInt(req.query.month) || now.getMonth() + 1;
  
  db.getMonthlyReportData(year, month, (err, posts) => {
    if (err) {
      console.error(err);
      return res.status(500).send('データベースエラー');
    }
    
    db.getMonthlyGoal(year, month, (goalErr, goal) => {
      if (goalErr) {
        console.error(goalErr);
      }
      
      const reportData = generateMonthlyReportData(posts, goal, year, month);
      res.render('monthly-report', { reportData, year, month });
    });
  });
});

// ルート - フォロワー履歴追加
app.post('/follower-history', (req, res) => {
  const date = req.body.date;
  const followers_count = parseInt(req.body.followers_count);
  
  db.addFollowerHistory(date, followers_count, (err) => {
    if (err) {
      console.error(err);
      return res.status(500).send('フォロワー履歴の保存に失敗しました');
    }
    res.redirect('/reports');
  });
});

// API - フォロワーグラフデータ取得
app.get('/api/follower-chart-data', (req, res) => {
  const year = parseInt(req.query.year) || new Date().getFullYear();
  const month = parseInt(req.query.month) || new Date().getMonth() + 1;
  
  db.getMonthlyFollowerHistory(year, month, (err, history) => {
    if (err) {
      console.error(err);
      return res.status(500).json({ error: 'データベースエラー' });
    }
    
    const chartData = processFollowerChartData(history);
    res.json(chartData);
  });
});





// ルート - PDFレポート生成
app.get('/reports/pdf', async (req, res) => {
  try {
    const year = parseInt(req.query.year) || new Date().getFullYear();
    const month = parseInt(req.query.month) || new Date().getMonth() + 1;
    
    const pdf = await generatePDFReport(year, month);
    
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="monthly-report-${year}-${month.toString().padStart(2, '0')}.pdf"`);
    res.send(pdf);
  } catch (error) {
    console.error('PDF生成エラー:', error);
    res.status(500).send('PDFの生成に失敗しました');
  }
});

// 月次レポートデータ生成関数
function generateMonthlyReportData(posts, goal, year, month) {
  if (!posts || posts.length === 0) {
    return {
      summary: {
        totalPosts: 0,
        totalLikes: 0,
        totalComments: 0,
        totalSaves: 0,
        avgEngagement: 0,
        bestPost: null,
        followersGrowth: 0
      },
      insights: [],
      recommendations: []
    };
  }

  // サマリー計算
  const totalPosts = posts.length;
  const totalLikes = posts.reduce((sum, post) => sum + (post.likes || 0), 0);
  const totalComments = posts.reduce((sum, post) => sum + (post.comments || 0), 0);
  const totalSaves = posts.reduce((sum, post) => sum + (post.saves || 0), 0);
  const avgEngagement = Math.round((totalLikes + totalComments + totalSaves) / totalPosts);
  
  const bestPost = posts.reduce((best, post) => {
    const engagement = (post.likes || 0) + (post.comments || 0) + (post.saves || 0);
    const bestEngagement = (best.likes || 0) + (best.comments || 0) + (best.saves || 0);
    return engagement > bestEngagement ? post : best;
  });

  // フォロワー成長率
  const followersGrowth = goal ? 
    Math.round(((goal.current_followers - (goal.target_followers * 0.9)) / (goal.target_followers * 0.9)) * 100) : 0;

  // インサイト生成
  const insights = generateInsights(posts);
  
  // 改善提案生成
  const recommendations = generateRecommendations(posts, goal);

  return {
    summary: {
      totalPosts,
      totalLikes,
      totalComments,
      totalSaves,
      avgEngagement,
      bestPost,
      followersGrowth
    },
    insights,
    recommendations,
    posts
  };
}

// インサイト生成
function generateInsights(posts) {
  const insights = [];
  
  // 投稿タイプ分析
  const typeStats = {};
  posts.forEach(post => {
    if (!typeStats[post.post_type]) {
      typeStats[post.post_type] = { count: 0, totalEngagement: 0 };
    }
    typeStats[post.post_type].count++;
    typeStats[post.post_type].totalEngagement += (post.likes || 0) + (post.comments || 0) + (post.saves || 0);
  });

  const bestType = Object.keys(typeStats).reduce((best, type) => {
    const avgEngagement = typeStats[type].totalEngagement / typeStats[type].count;
    const bestAvg = typeStats[best] ? typeStats[best].totalEngagement / typeStats[best].count : 0;
    return avgEngagement > bestAvg ? type : best;
  });

  insights.push(`${bestType === 'image' ? '画像' : bestType === 'reel' ? 'リール' : 'ストーリー'}投稿が最も高いエンゲージメントを獲得`);

  // 時間帯分析
  const timeStats = {};
  posts.forEach(post => {
    const hour = parseInt(post.post_time.split(':')[0]);
    if (!timeStats[hour]) {
      timeStats[hour] = { count: 0, totalEngagement: 0 };
    }
    timeStats[hour].count++;
    timeStats[hour].totalEngagement += (post.likes || 0) + (post.comments || 0) + (post.saves || 0);
  });

  const bestHour = Object.keys(timeStats).reduce((best, hour) => {
    const avgEngagement = timeStats[hour].totalEngagement / timeStats[hour].count;
    const bestAvg = timeStats[best] ? timeStats[best].totalEngagement / timeStats[best].count : 0;
    return avgEngagement > bestAvg ? hour : best;
  });

  insights.push(`${bestHour}時台の投稿が最も効果的`);

  return insights;
}

// 改善提案生成
function generateRecommendations(posts, goal) {
  const recommendations = [];
  
  if (posts.length < 15) {
    recommendations.push('投稿頻度を増やして月20投稿を目指しましょう');
  }
  
  const avgLikes = posts.reduce((sum, post) => sum + (post.likes || 0), 0) / posts.length;
  if (avgLikes < 50) {
    recommendations.push('投稿時間やハッシュタグを見直してエンゲージメント向上を図りましょう');
  }
  
  if (goal && goal.current_followers < goal.target_followers) {
    recommendations.push('目標達成のため、より魅力的なコンテンツ作りを心がけましょう');
  }
  
  recommendations.push('ストーリーズ機能を積極的に活用して、フォロワーとの距離を縮めましょう');
  
  return recommendations;
}

// PDF生成関数（簡易版）
async function generatePDFReport(year, month) {
  const puppeteer = require('puppeteer');
  
  return new Promise((resolve, reject) => {
    db.getMonthlyReportData(year, month, async (err, posts) => {
      if (err) {
        reject(err);
        return;
      }
      
      db.getMonthlyGoal(year, month, async (goalErr, goal) => {
        try {
          const reportData = generateMonthlyReportData(posts, goal, year, month);
          
          const browser = await puppeteer.launch();
          const page = await browser.newPage();
          
          const html = generateReportHTML(reportData, year, month);
          await page.setContent(html);
          
          const pdf = await page.pdf({
            format: 'A4',
            printBackground: true,
            margin: {
              top: '20mm',
              bottom: '20mm',
              left: '20mm',
              right: '20mm'
            }
          });
          
          await browser.close();
          resolve(pdf);
        } catch (error) {
          reject(error);
        }
      });
    });
  });
}

// レポート用HTML生成
function generateReportHTML(reportData, year, month) {
  return `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="UTF-8">
      <title>月次レポート ${year}年${month}月</title>
      <style>
        body { font-family: 'Hiragino Sans', sans-serif; margin: 0; padding: 20px; }
        .header { text-align: center; border-bottom: 2px solid #667eea; padding-bottom: 20px; margin-bottom: 30px; }
        .section { margin-bottom: 30px; }
        .summary-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 20px; }
        .summary-item { text-align: center; padding: 15px; background: #f8f9fa; border-radius: 8px; }
        .number { font-size: 24px; font-weight: bold; color: #667eea; }
        .insights, .recommendations { background: #f8f9fa; padding: 20px; border-radius: 8px; }
        .insights h3, .recommendations h3 { color: #667eea; margin-top: 0; }
        ul { padding-left: 20px; }
        li { margin-bottom: 8px; }
      </style>
    </head>
    <body>
      <div class="header">
        <h1>Instagram運用月次レポート</h1>
        <h2>${year}年${month}月</h2>
      </div>
      
      <div class="section">
        <h3>📊 パフォーマンスサマリー</h3>
        <div class="summary-grid">
          <div class="summary-item">
            <div class="number">${reportData.summary.totalPosts}</div>
            <div>総投稿数</div>
          </div>
          <div class="summary-item">
            <div class="number">${reportData.summary.totalLikes.toLocaleString()}</div>
            <div>総いいね数</div>
          </div>
          <div class="summary-item">
            <div class="number">${reportData.summary.avgEngagement}</div>
            <div>平均エンゲージメント</div>
          </div>
        </div>
      </div>
      
      <div class="section insights">
        <h3>💡 今月のインサイト</h3>
        <ul>
          ${reportData.insights.map(insight => `<li>${insight}</li>`).join('')}
        </ul>
      </div>
      
      <div class="section recommendations">
        <h3>🚀 改善提案</h3>
        <ul>
          ${reportData.recommendations.map(rec => `<li>${rec}</li>`).join('')}
        </ul>
      </div>
      
      <div class="footer" style="text-align: center; margin-top: 50px; color: #6c757d;">
        <p>Generated by Instagram Analytics System</p>
      </div>
    </body>
    </html>
  `;
}

// サーバー起動
const PORT = process.env.PORT || port;
if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`SNS Analytics Server running at http://localhost:${PORT}`);
  });
}

module.exports = app;

// アプリケーション終了時のクリーンアップ
process.on('SIGINT', () => {
  console.log('\nサーバーを終了しています...');
  db.close();
  process.exit(0);
});