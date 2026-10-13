import { ArrowLeft } from 'lucide-react';
import { Link } from 'wouter';
import '@/styles/home-button.css';

export function HomeButton() {
  return (
    <Link href="/" className="home-button" aria-label="Back to Crypto Order Flow home">
      <ArrowLeft size={15} aria-hidden="true" />
      <span>Home</span>
    </Link>
  );
}
