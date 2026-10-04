// Everything about the site that isn't a book, film or essay lives here.
export const site = {
  name: 'Granthalaya',
  owner: 'Sarthak',
  city: 'Pune',
  url: 'https://granthalaya-sarthak.vercel.app',
  description: 'Everything I read, watch, and keep coming back to — a personal library, painted in Pune.',
  // Small line above the big headline on the home page.
  season: 'Monsoon 2026 · Pune',
  // "Thinking about" card on the home page, and the big quote on the Notes page.
  lineOfTheWeek: {
    text: 'Clouds come floating into my life, no longer to carry rain or usher storm, but to add color to my sunset sky.',
    by: 'Rabindranath Tagore',
    source: 'Stray Birds',
    year: 1916,
  },
  // Reading pace used to estimate time spent on books (minutes per page).
  minutesPerPage: 1.1,
  // Reading speed used for essays (words per minute).
  wordsPerMinute: 230,
  // Covers: 'real' shows real book covers and film posters where we have them (public/covers/),
  // 'painted' shows the painted covers everywhere.
  covers: 'real' as 'real' | 'painted',
  // The one goal shown on the Stats page.
  goal: { label: 'Books this year', target: 30 },
};
