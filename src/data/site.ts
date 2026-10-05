// Settings for the whole site. Everything personal (name, season line, line of the week, goal, links)
// now lives in each person's profile, edited in Settings, not here.
export const site = {
  name: 'Granthalaya',
  url: 'https://granthalaya-sarthak.vercel.app',
  description: 'A shelf for everything you read and watch: books, films, TV and essays, with the lines that stayed with you.',

  // Who made the site (footer credit), and the shelf that was here first.
  // Old addresses like /library/paterson redirect to this person's shelf.
  maker: 'Sarthak',
  founder: 'sarthak',
  // An email address for privacy questions and data requests, shown on /privacy and /terms.
  // Fill this in before the public launch (Google asks for a way to contact you).
  contact: '',

  // Reading pace used to estimate time spent on books (minutes per page) and essays (words per minute).
  minutesPerPage: 1.1,
  wordsPerMinute: 230,

  // What the shepherd in the footer says when no one's line of the week is on the page.
  line: { text: 'Clouds come floating into my life, no longer to carry rain or usher storm, but to add color to my sunset sky.', by: 'Rabindranath Tagore', source: 'Stray Birds' },

  // Where the footer looks for rain (it rains in the painting when it rains here).
  weather: { lat: 18.52, lon: 73.86 },

  // Covers: 'real' shows real book covers and film posters where we have them,
  // 'painted' shows the painted covers everywhere.
  covers: 'real' as 'real' | 'painted',
};
