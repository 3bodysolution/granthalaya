// Settings for the whole site. Everything personal (name, season line, line of the week, goal, links)
// now lives in each person's profile, edited in Settings, not here.
export const site = {
  name: 'Granthalaya',
  url: 'https://mygranthalaya.vercel.app',
  description: 'A shelf for everything you read and watch: books, films, TV and essays, and what you thought of each.',

  // Who made the site (footer credit), and the shelf that was here first.
  // Old addresses like /library/paterson redirect to this person's shelf.
  maker: 'Sarthak',
  founder: 'sarthak',
  // An email address for privacy questions and data requests, shown on /privacy and /terms.

  contact: 'granthalayasupport@gmail.com',

  // Reading pace used to estimate time spent on books (minutes per page) and essays (words per minute).
  minutesPerPage: 1.1,
  wordsPerMinute: 230,

  // What the shepherd in the footer says, one a week, on pages without a title of their own (title and entry pages say the
  // title's own line). Hand-picked, short, and out of copyright.
  lines: [
    { text: 'Clouds come floating into my life, no longer to carry rain or usher storm, but to add color to my sunset sky.', by: 'Rabindranath Tagore', source: 'Stray Birds' },
    { text: 'Time is but the stream I go a-fishing in.', by: 'Henry David Thoreau', source: 'Walden' },
    { text: 'Let life be beautiful like summer flowers and death like autumn leaves.', by: 'Rabindranath Tagore', source: 'Stray Birds' },
    { text: 'A thing of beauty is a joy for ever.', by: 'John Keats', source: 'Endymion' },
    { text: 'Hope is the thing with feathers that perches in the soul.', by: 'Emily Dickinson' },
    { text: 'I am large, I contain multitudes.', by: 'Walt Whitman', source: 'Song of Myself' },
    { text: 'Where the mind is without fear and the head is held high.', by: 'Rabindranath Tagore', source: 'Gitanjali' },
    { text: 'Why, sometimes I’ve believed as many as six impossible things before breakfast.', by: 'Lewis Carroll', source: 'Through the Looking-Glass' },
    { text: 'A woman must have money and a room of her own if she is to write fiction.', by: 'Virginia Woolf', source: 'A Room of One’s Own' },
    { text: 'The butterfly counts not months but moments, and has time enough.', by: 'Rabindranath Tagore', source: 'Fireflies' },
  ] as { text: string; by?: string; source?: string }[],

  // Where the footer looks for rain (it rains in the painting when it rains here).
  weather: { lat: 18.52, lon: 73.86 },

  // Covers: 'real' shows real book covers and film posters where we have them,
  // 'painted' shows the painted covers everywhere.
  covers: 'real' as 'real' | 'painted',
};
