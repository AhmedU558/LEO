import { Heart, Github, Twitter, ExternalLink } from '../components/icons';

const VERSION = __APP_VERSION__;

const highlights = [
  'Open Source',
  'Privacy-first',
  'Self-hosted',
  '100+ AI Providers',
  '148+ Built-in Tools',
  '47 Database Tables',
];

export function AboutPage() {
  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <header className="px-6 py-4 border-b border-border dark:border-dark-border">
        <h2 className="text-lg font-semibold text-text-primary dark:text-dark-text-primary">
          About
        </h2>
        <p className="text-sm text-text-muted dark:text-dark-text-muted">
          About LEO and the project it is built on
        </p>
      </header>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-6">
        <div className="max-w-2xl mx-auto space-y-8">
          {/* Hero */}
          <div className="flex flex-col items-center text-center space-y-4">
            <img
              src="/leo-logo.png"
              alt="LEO Logo"
              className="w-28 h-28 rounded-2xl shadow-lg object-cover"
            />
            <div>
              <h1 className="text-3xl font-bold text-text-primary dark:text-dark-text-primary">
                LEO
              </h1>
              <p className="text-text-muted dark:text-dark-text-muted mt-1">
                Logical Execution &amp; Orchestration
              </p>
              <span className="inline-block mt-2 px-2.5 py-0.5 text-xs font-medium rounded-full bg-primary/10 text-primary">
                v{VERSION}
              </span>
            </div>
          </div>

          {/* Description */}
          <div className="p-5 bg-bg-secondary dark:bg-dark-bg-secondary rounded-xl border border-border dark:border-dark-border">
            <p className="text-sm text-text-secondary dark:text-dark-text-secondary leading-relaxed">
              LEO is an autonomous AI system that understands, plans, authorizes, executes, and
              audits tasks. It is self-hosted and privacy-first: connect 100+ AI providers, manage
              personal data, automate workflows with triggers and plans, and interact through
              multiple channels &mdash; all from your own infrastructure.
            </p>
            <div className="flex flex-wrap gap-2 mt-4">
              {highlights.map((h) => (
                <span
                  key={h}
                  className="px-2.5 py-1 text-xs font-medium rounded-md bg-bg-tertiary dark:bg-dark-bg-tertiary text-text-secondary dark:text-dark-text-secondary border border-border dark:border-dark-border"
                >
                  {h}
                </span>
              ))}
            </div>
          </div>

          {/* Links */}
          <div className="p-5 bg-bg-secondary dark:bg-dark-bg-secondary rounded-xl border border-border dark:border-dark-border space-y-3">
            <h3 className="text-sm font-semibold text-text-primary dark:text-dark-text-primary mb-3">
              Links
            </h3>
            <LinkRow
              icon={<Github className="w-4 h-4" />}
              label="GitHub"
              href="https://github.com/AhmedU558/LEO"
              display="github.com/AhmedU558/LEO"
            />
          </div>

          {/* Built on OwnPilot */}
          <div className="p-5 bg-bg-secondary dark:bg-dark-bg-secondary rounded-xl border border-border dark:border-dark-border">
            <h3 className="text-sm font-semibold text-text-primary dark:text-dark-text-primary mb-2">
              Built on OwnPilot
            </h3>
            <p className="text-sm text-text-secondary dark:text-dark-text-secondary leading-relaxed mb-4">
              LEO is built on{' '}
              <a
                href="https://github.com/ownpilot/ownpilot"
                target="_blank"
                rel="noopener noreferrer"
                className="text-primary hover:underline"
              >
                OwnPilot
              </a>
              , the open-source project created by Ersin KO&Ccedil; and released under the MIT
              License.
            </p>
            <div className="flex items-center gap-4">
              <div className="w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center text-primary font-bold text-lg">
                EK
              </div>
              <div className="flex-1">
                <p className="font-semibold text-text-primary dark:text-dark-text-primary">
                  Ersin KO&Ccedil;
                </p>
                <div className="flex flex-wrap gap-x-4 gap-y-1 mt-1">
                  <a
                    href="https://github.com/ersinkoc"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1.5 text-xs text-text-muted dark:text-dark-text-muted hover:text-primary transition-colors"
                  >
                    <Github className="w-3.5 h-3.5" />
                    ersinkoc
                  </a>
                  <a
                    href="https://x.com/ersinkoc"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1.5 text-xs text-text-muted dark:text-dark-text-muted hover:text-primary transition-colors"
                  >
                    <Twitter className="w-3.5 h-3.5" />
                    ersinkoc
                  </a>
                </div>
              </div>
            </div>
          </div>

          {/* Upstream origin */}
          <div className="text-center pb-8">
            <div className="flex items-center justify-center gap-1.5 text-xs text-text-muted dark:text-dark-text-muted">
              OwnPilot is made with
              <Heart className="w-3.5 h-3.5 text-error inline-block" />
              in Estonia
              <span className="ml-1" role="img" aria-label="Estonia">
                &#127466;&#127466;
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function LinkRow({
  icon,
  label,
  href,
  display,
}: {
  icon: React.ReactNode;
  label: string;
  href: string;
  display: string;
}) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="flex items-center gap-3 p-2.5 -mx-2.5 rounded-lg hover:bg-bg-tertiary dark:hover:bg-dark-bg-tertiary transition-colors group"
    >
      <span className="text-text-muted dark:text-dark-text-muted">{icon}</span>
      <span className="text-sm text-text-secondary dark:text-dark-text-secondary w-16">
        {label}
      </span>
      <span className="text-sm text-text-primary dark:text-dark-text-primary flex-1">
        {display}
      </span>
      <ExternalLink className="w-3.5 h-3.5 text-text-muted dark:text-dark-text-muted opacity-0 group-hover:opacity-100 transition-opacity" />
    </a>
  );
}
