export type Finding = {
  claim: string;
  sourceUrl: string;
  snippet: string;
};

export type ResearchReport = {
  sections: Array<{
    heading: string;
    body: string;
  }>;
  citations: Array<{
    claim: string;
    sourceUrl: string;
  }>;
};

export type SearchWebResult = {
  query: string;
  answer: string;
  sources: Array<{
    title?: string;
    url: string;
  }>;
};

export type SourcePage = {
  title?: string;
  url: string;
  text: string;
  error?: string;
};

export type ExtractFindingsResult = {
  findings: Finding[];
};
