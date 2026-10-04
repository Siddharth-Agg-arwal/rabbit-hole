const state = { topics: [], channels: [], activeTopic: '', pick: null };

const $ = (id) => document.getElementById(id);
const topicGrid = $('topicGrid');
const channelGrid = $('channelGrid');
const topicTemplate = $('topicTemplate');
const channelTemplate = $('channelTemplate');

function localDateKey(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function prettyDate() {
  return new Intl.DateTimeFormat('en-IN', { weekday: 'short', day: '2-digit', month: 'short' }).format(new Date()).toUpperCase();
}

async function api(path, options) {
  const response = await fetch(path, options);
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body.error || 'Something went wrong.');
  }
  return response.json();
}

function hookDots(score) {
  return `${'●'.repeat(score)}${'○'.repeat(5 - score)}`;
}

function renderTopics() {
  topicGrid.innerHTML = '';
  state.topics.forEach((topic) => {
    const node = topicTemplate.content.firstElementChild.cloneNode(true);
    node.querySelector('.topic-number').textContent = topic.glyph;
    node.querySelector('h3').textContent = topic.topic;
    node.querySelector('.topic-kicker').textContent = topic.kicker;
    node.querySelector('.topic-count').textContent = `${topic.count} CHANNEL${topic.count === 1 ? '' : 'S'}`;
    node.classList.toggle('active', state.activeTopic === topic.topic);
    node.addEventListener('click', () => selectTopic(topic.topic));
    topicGrid.appendChild(node);
  });
}

function renderChannels() {
  channelGrid.innerHTML = '';
  const channels = state.activeTopic ? state.channels.filter(c => c.topic === state.activeTopic) : state.channels;
  $('feedCount').textContent = `${String(channels.length).padStart(2, '0')} CHANNELS`;
  $('feedTitle').textContent = state.activeTopic || 'Worth your attention.';
  $('feedKicker').textContent = state.activeTopic ? 'TONIGHT’S LANE' : 'THE FEED';

  channels.forEach(channel => {
    const node = channelTemplate.content.firstElementChild.cloneNode(true);
    node.href = channel.url;
    node.querySelector('.card-topic').textContent = channel.topic;
    node.querySelector('h3').textContent = channel.name;
    node.querySelector('.channel-handle').textContent = channel.handle;
    node.querySelector('.description').textContent = channel.description;
    node.querySelector('.vibe').textContent = channel.vibe;
    node.querySelector('.hook').textContent = hookDots(channel.hook);
    channelGrid.appendChild(node);
  });
}

function renderPick() {
  if (!state.pick) return;
  state.activeTopic = state.pick.topic;
  const meta = state.topics.find(t => t.topic === state.pick.topic);
  $('pickTitle').textContent = state.pick.topic;
  $('pickDescription').textContent = meta?.kicker || 'Tonight’s rabbit hole.';
  $('pickBtn').querySelector('span:first-child').textContent = 'Keep tonight’s pick';
  $('rerollBtn').classList.remove('hidden');

  const card = $('chosenCard');
  card.href = state.pick.channel.url;
  $('chosenTopic').textContent = `START HERE / ${state.pick.topic.toUpperCase()}`;
  $('chosenName').textContent = state.pick.channel.name;
  $('chosenVibe').textContent = state.pick.channel.vibe;
  card.classList.remove('hidden');
  renderTopics();
  renderChannels();
}

function selectTopic(topic) {
  state.activeTopic = state.activeTopic === topic ? '' : topic;
  renderTopics();
  renderChannels();
  document.querySelector('.feed').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

async function chooseTonight(reroll = false) {
  const button = reroll ? $('rerollBtn') : $('pickBtn');
  button.disabled = true;
  try {
    state.pick = await api('/api/pick', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ date: localDateKey(), reroll })
    });
    renderPick();
  } catch (error) {
    $('pickDescription').textContent = error.message;
  } finally {
    button.disabled = false;
  }
}

async function init() {
  $('todayLabel').textContent = prettyDate();
  try {
    const [topics, channels, pick] = await Promise.all([
      api('/api/topics'),
      api('/api/channels'),
      api(`/api/today?date=${localDateKey()}`)
    ]);
    state.topics = topics;
    state.channels = channels;
    state.pick = pick;
    renderTopics();
    renderChannels();
    if (pick) renderPick();
  } catch (error) {
    $('pickDescription').textContent = `Could not load the feed: ${error.message}`;
  }
}

$('pickBtn').addEventListener('click', () => chooseTonight(false));
$('rerollBtn').addEventListener('click', () => chooseTonight(true));
$('showAllBtn').addEventListener('click', () => {
  state.activeTopic = '';
  renderTopics();
  renderChannels();
});

init();
