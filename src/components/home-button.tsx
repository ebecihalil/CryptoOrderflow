import { ArrowLeft } from 'lucide-react';
import { Link, useLocation } from 'wouter';
import '@/styles/home-button.css';

export function HomeButton() {
  const [location] = useLocation();
  // Already on the home page: no need for a link back to it.
  if (location === '/' || location === '') return null;
  return (
    <Link href="/" className="home-button" aria-label="Back to Crypto Order Flow home">
      <ArrowLeft size={15} aria-hidden="true" />
      <span>Home</span>
    </Link>
  );
}
