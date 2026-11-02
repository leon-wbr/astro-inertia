/** The props the inertia-typo3 adapter shares with every page. */
export interface NavItem {
  uid: number;
  title: string;
  link: string;
  active: boolean;
  current: boolean;
  children: NavItem[];
}

export interface Language {
  id: number;
  title: string;
  code: string;
  link: string;
  active: boolean;
}

export interface SharedProps {
  site: { title: string; home: string; language: string; languages: Language[] };
  navigation: NavItem[];
  /** Shared as a once prop; astro-inertia always does full page loads, so it is always there. */
  labels: { footer: string; loadedAt: string };
  title: string;
  contentElements: ContentElement[];
}

export interface ContentElement {
  CType: string;
  data: { uid: number; header?: string; subheader?: string; bodytext?: string; [key: string]: unknown };
  /** HTML rendered by TYPO3 (fluid_styled_content), or null for typed elements. */
  html: string | null;
}
