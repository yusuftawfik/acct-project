import { useEffect, useState } from 'react';

// True while the browser window matches the CSS media query. Used so the cards can only be collapsed on phones.
export function useMediaQuery(query) {
  const [matches, setMatches] = useState(() => window.matchMedia(query).matches);

  useEffect(() => {
    const mq = window.matchMedia(query);
    const onChange = () => setMatches(mq.matches);
    onChange();
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, [query]);

  return matches;
}

// Phones and small tablets. Keep in sync with the 768px block in responsive.css.
export const MOBILE_QUERY = '(max-width: 768px)';
