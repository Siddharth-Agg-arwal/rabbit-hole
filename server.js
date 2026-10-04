import express from 'express';
import pg from 'pg';
import path from 'path';
import { fileURLToPath } from 'url';

const { Pool } = pg;
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PORT = Number(process.env.PORT || 3000);

const TOPIC_META = {
  'Future & AI': { kicker: 'WHAT CHANGES NEXT', glyph: '01' },
  'Science': { kicker: 'MAKE REALITY WEIRDER', glyph: '02' },
  'Engineering': { kicker: 'HOW THINGS ACTUALLY WORK', glyph: '03' },
  'World & Systems': { kicker: 'SEE THE MACHINERY', glyph: '04' },
  'Money & Business': { kicker: 'UNDERSTAND THE INCENTIVES', glyph: '05' },
  'Documentaries': { kicker: 'STORIES WORTH AN HOUR', glyph: '06' }
};

const SEED_CHANNELS = [
  ['Cleo Abram', '@CleoAbram', 'https://www.youtube.com/@CleoAbram', 'Future & AI', 'AI, robotics, space, quantum computing and ambitious future technology.', 'Optimistic future-tech documentary', 5],
  ['Fireship', '@Fireship', 'https://www.youtube.com/@Fireship', 'Future & AI', 'Fast software, AI, programming-language and developer-tool explainers.', 'Tech dopamine, but useful', 5],
  ['AI Explained', '@aiexplained-official', 'https://www.youtube.com/@aiexplained-official', 'Future & AI', 'Calm analysis of new AI models, capabilities, papers and industry shifts.', 'Current AI without the shouting', 4],
  ['Two Minute Papers', '@TwoMinutePapers', 'https://www.youtube.com/@TwoMinutePapers', 'Future & AI', 'Visual tours of new AI, graphics and simulation research.', 'Research that feels like magic', 4],
  ['Asianometry', '@Asianometry', 'https://www.youtube.com/@Asianometry', 'Future & AI', 'Semiconductors, TSMC, ASML and Asian technology-industry history.', 'Deep tech + industrial history', 4],
  ['ColdFusion', '@ColdFusion', 'https://www.youtube.com/@ColdFusion', 'Future & AI', 'Technology companies, inventions, business failures and tech history.', 'Slow, cinematic tech stories', 5],
  ['Veritasium', '@veritasium', 'https://www.youtube.com/@veritasium', 'Science', 'Physics, mathematics, experiments and counterintuitive scientific mysteries.', 'Mystery-first science', 5],
  ['Kurzgesagt', '@kurzgesagt', 'https://www.youtube.com/@kurzgesagt', 'Science', 'Space, biology, civilization, risk and giant philosophical questions.', 'Beautiful existential animation', 5],
  ['3Blue1Brown', '@3blue1brown', 'https://www.youtube.com/@3blue1brown', 'Science', 'Visual mathematics, probability, neural networks, calculus and linear algebra.', 'Math that finally clicks', 5],
  ['PBS Space Time', '@pbsspacetime', 'https://www.youtube.com/@pbsspacetime', 'Science', 'Black holes, relativity, quantum physics and cosmology with real depth.', 'Brain-melting space physics', 4],
  ['SmarterEveryDay', '@smartereveryday', 'https://www.youtube.com/@smartereveryday', 'Science', 'Hands-on investigations into rockets, manufacturing, motion and physical systems.', 'Curiosity with experiments', 5],
  ['Branch Education', '@BranchEducation', 'https://www.youtube.com/@BranchEducation', 'Engineering', '3D visual breakdowns of CPUs, GPUs, SSDs, cameras, motors and electronics.', 'See inside the machine', 5],
  ['Practical Engineering', '@PracticalEngineeringChannel', 'https://www.youtube.com/@PracticalEngineeringChannel', 'Engineering', 'Dams, roads, bridges, flooding, power grids and civil infrastructure.', 'Everyday infrastructure decoded', 4],
  ['Real Engineering', '@RealEngineering', 'https://www.youtube.com/@RealEngineering', 'Engineering', 'Aerospace, energy, engines, transport and large-scale engineering.', 'High-production engineering docs', 4],
  ['Mustard', '@MustardChannel', 'https://www.youtube.com/@MustardChannel', 'Engineering', 'Forgotten aircraft, trains, ships and ambitious engineering projects.', 'Gorgeous 3D engineering history', 5],
  ['Computerphile', '@Computerphile', 'https://www.youtube.com/@Computerphile', 'Engineering', 'Security, cryptography, networking, algorithms and computer-science ideas.', 'Nerdy explanations from experts', 4],
  ['Wendover Productions', '@Wendoverproductions', 'https://www.youtube.com/@Wendoverproductions', 'World & Systems', 'Airlines, logistics, infrastructure, borders and global systems.', 'How the world moves', 5],
  ['neo', '@neoexplains', 'https://www.youtube.com/@neoexplains', 'World & Systems', 'Geopolitics, borders, infrastructure, cities and geography through polished maps.', 'Elegant visual explainers', 5],
  ['PolyMatter', '@PolyMatter', 'https://www.youtube.com/@PolyMatter', 'World & Systems', 'Trade, China, geopolitics, economics and global business systems.', 'Calm systems thinking', 4],
  ['Modern MBA', '@ModernMBA', 'https://www.youtube.com/@ModernMBA', 'Money & Business', 'Business models, pricing, strategy and the economics behind familiar companies.', 'Business-school ideas without class', 5],
  ['Patrick Boyle', '@PBoyle', 'https://www.youtube.com/@PBoyle', 'Money & Business', 'Markets, finance, bubbles, corporate failures and economic events.', 'Finance with dry humour', 5],
  ['How Money Works', '@HowMoneyWorks', 'https://www.youtube.com/@HowMoneyWorks', 'Money & Business', 'Debt, housing, labour, wealth and the mechanics of financial systems.', 'Useful uncomfortable economics', 4],
  ['fern', '@fern-tv', 'https://www.youtube.com/@fern-tv', 'Documentaries', 'Internet stories, crime, business, geopolitics and strange historical events.', 'Closest thing to Netflix here', 5],
  ['James Jani', '@JamesJani', 'https://www.youtube.com/@JamesJani', 'Documentaries', 'Scams, wealth, gurus, psychology and modern business culture.', 'Long-form cinematic rabbit holes', 5]
];

const pool = process.env.DATABASE_URL
  ? new Pool({
      connectionString: process.env.DATABASE_URL,
      max: 10,
      idleTimeoutMillis: 60_000,
      connectionTimeoutMillis: 10_000
    })
  : null;

if (pool) {
  pool.on('error', (error) => console.error('Postgres pool error:', error.message));
}

async function ensureDatabase() {
  if (!pool) {
    console.warn('DATABASE_URL not set — API will use in-memory channel data and daily picks will not persist.');
    return;
  }

  await pool.query(`
    CREATE TABLE IF NOT EXISTS channels (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      handle TEXT,
      url TEXT NOT NULL,
      topic TEXT NOT NULL,
      description TEXT NOT NULL,
      vibe TEXT NOT NULL,
      hook SMALLINT NOT NULL CHECK (hook BETWEEN 1 AND 5),
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS daily_picks (
      pick_date DATE PRIMARY KEY,
      topic TEXT NOT NULL,
      channel_id INTEGER NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE INDEX IF NOT EXISTS channels_topic_idx ON channels(topic);
  `);

  const count = Number((await pool.query('SELECT COUNT(*)::int AS count FROM channels')).rows[0].count);
  if (count === 0) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      for (let i = 0; i < SEED_CHANNELS.length; i += 1) {
        const [name, handle, url, topic, description, vibe, hook] = SEED_CHANNELS[i];
        await client.query(
          `INSERT INTO channels (name, handle, url, topic, description, vibe, hook, sort_order)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
           ON CONFLICT (name) DO NOTHING`,
          [name, handle, url, topic, description, vibe, hook, i]
        );
      }
      await client.query('COMMIT');
      console.log(`Seeded ${SEED_CHANNELS.length} channels.`);
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }
}

const memoryChannels = SEED_CHANNELS.map((c, index) => ({
  id: index + 1,
  name: c[0], handle: c[1], url: c[2], topic: c[3], description: c[4], vibe: c[5], hook: c[6], sort_order: index
}));
const memoryPicks = new Map();

function isValidDate(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(value || ''));
}

function serializeChannel(channel) {
  return {
    id: Number(channel.id),
    name: channel.name,
    handle: channel.handle,
    url: channel.url,
    topic: channel.topic,
    description: channel.description,
    vibe: channel.vibe,
    hook: Number(channel.hook)
  };
}

function randomItem(items) {
  return items[Math.floor(Math.random() * items.length)];
}

const app = express();
app.use(express.json({ limit: '32kb' }));

app.get('/api/health', async (_req, res) => {
  if (!pool) return res.json({ ok: true, database: 'fallback' });
  try {
    await pool.query('SELECT 1');
    return res.json({ ok: true, database: 'connected' });
  } catch (error) {
    return res.status(503).json({ ok: false, database: 'unavailable', error: error.message });
  }
});

app.get('/api/topics', async (_req, res) => {
  try {
    let rows;
    if (pool) {
      rows = (await pool.query(`SELECT topic, COUNT(*)::int AS count FROM channels GROUP BY topic ORDER BY MIN(sort_order)`)).rows;
    } else {
      rows = Object.keys(TOPIC_META).map(topic => ({ topic, count: memoryChannels.filter(c => c.topic === topic).length }));
    }
    res.json(rows.map(row => ({ ...row, ...TOPIC_META[row.topic] })));
  } catch (error) {
    res.status(500).json({ error: 'Could not load topics.' });
  }
});

app.get('/api/channels', async (req, res) => {
  const topic = typeof req.query.topic === 'string' ? req.query.topic : '';
  try {
    let rows;
    if (pool) {
      rows = topic
        ? (await pool.query('SELECT * FROM channels WHERE topic = $1 ORDER BY sort_order', [topic])).rows
        : (await pool.query('SELECT * FROM channels ORDER BY sort_order')).rows;
    } else {
      rows = topic ? memoryChannels.filter(c => c.topic === topic) : memoryChannels;
    }
    res.json(rows.map(serializeChannel));
  } catch (error) {
    res.status(500).json({ error: 'Could not load channels.' });
  }
});

app.get('/api/today', async (req, res) => {
  const date = String(req.query.date || '');
  if (!isValidDate(date)) return res.status(400).json({ error: 'Use date=YYYY-MM-DD.' });

  try {
    if (!pool) return res.json(memoryPicks.get(date) || null);
    const { rows } = await pool.query(
      `SELECT d.pick_date, d.topic, d.updated_at,
              c.id, c.name, c.handle, c.url, c.description, c.vibe, c.hook
       FROM daily_picks d
       JOIN channels c ON c.id = d.channel_id
       WHERE d.pick_date = $1`, [date]
    );
    if (!rows.length) return res.json(null);
    const row = rows[0];
    res.json({ date: row.pick_date, topic: row.topic, channel: serializeChannel({ ...row, topic: row.topic }) });
  } catch (error) {
    res.status(500).json({ error: 'Could not load today’s pick.' });
  }
});

app.post('/api/pick', async (req, res) => {
  const date = String(req.body?.date || '');
  const requestedTopic = typeof req.body?.topic === 'string' ? req.body.topic : '';
  const reroll = Boolean(req.body?.reroll);

  if (!isValidDate(date)) return res.status(400).json({ error: 'Use date=YYYY-MM-DD.' });
  if (requestedTopic && !TOPIC_META[requestedTopic]) return res.status(400).json({ error: 'Unknown topic.' });

  try {
    if (!pool) {
      if (!reroll && memoryPicks.has(date)) return res.json(memoryPicks.get(date));
      const topic = requestedTopic || randomItem(Object.keys(TOPIC_META));
      const channel = randomItem(memoryChannels.filter(c => c.topic === topic));
      const pick = { date, topic, channel: serializeChannel(channel) };
      memoryPicks.set(date, pick);
      return res.json(pick);
    }

    if (!reroll) {
      const existing = await pool.query(
        `SELECT d.pick_date, d.topic, c.* FROM daily_picks d JOIN channels c ON c.id = d.channel_id WHERE d.pick_date = $1`,
        [date]
      );
      if (existing.rows.length) {
        const row = existing.rows[0];
        return res.json({ date: row.pick_date, topic: row.topic, channel: serializeChannel(row) });
      }
    }

    let topic = requestedTopic;
    if (!topic) {
      const topicResult = await pool.query('SELECT topic FROM channels GROUP BY topic ORDER BY random() LIMIT 1');
      topic = topicResult.rows[0]?.topic;
    }
    const channelResult = await pool.query('SELECT * FROM channels WHERE topic = $1 ORDER BY random() LIMIT 1', [topic]);
    if (!channelResult.rows.length) return res.status(404).json({ error: 'No channels for that topic.' });
    const channel = channelResult.rows[0];

    await pool.query(
      `INSERT INTO daily_picks (pick_date, topic, channel_id)
       VALUES ($1, $2, $3)
       ON CONFLICT (pick_date) DO UPDATE
       SET topic = EXCLUDED.topic, channel_id = EXCLUDED.channel_id, updated_at = NOW()`,
      [date, topic, channel.id]
    );

    res.json({ date, topic, channel: serializeChannel(channel) });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Could not choose tonight’s rabbit hole.' });
  }
});

app.use(express.static(path.join(__dirname, 'public'), { extensions: ['html'] }));
app.use((_req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

ensureDatabase()
  .then(() => {
    app.listen(PORT, '0.0.0.0', () => console.log(`Nightly Knowledge listening on :${PORT}`));
  })
  .catch((error) => {
    console.error('Database initialization failed:', error);
    process.exit(1);
  });
