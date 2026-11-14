export type Source = {
  id: number;
  title: string;
  url: string;
  content: string;
};

export type Verdict = "supported" | "partial" | "unsupported";

export type Claim = {
  text: string;
  sourceIds: number[];
  verdict: Verdict;
  reason: string;
};

export type AskResult = {
  question: string;
  sources: Source[];
  claims: Claim[];
  stats: {
    total: number;
    supported: number;
    partial: number;
    unsupported: number;
    ms: number;
  };
};
