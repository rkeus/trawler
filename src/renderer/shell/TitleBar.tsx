import { LogoMark } from '../components/Logo';

export function TitleBar() {
  return (
    <header className="titlebar">
      <LogoMark className="brand" />
      <b>TRAWLER</b>
      <span>website template downloader</span>
    </header>
  );
}
