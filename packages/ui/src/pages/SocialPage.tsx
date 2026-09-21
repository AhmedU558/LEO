import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router';
import { Share2, Plus, PenTool, Globe } from 'lucide-react';
import { useToast } from '../components/ToastProvider';
import type { SocialAccount, SocialContent } from '../types/leo';

export function SocialPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const tab = searchParams.get('tab') || 'accounts';
  const toast = useToast();

  const [accounts, setAccounts] = useState<SocialAccount[]>([]);
  const [drafts, setDrafts] = useState<SocialContent[]>([]);
  const [_isLoading, setIsLoading] = useState(true);
  const [draftText, setDraftText] = useState('');
  const [selectedPlatform, setSelectedPlatform] = useState('instagram');
  const [selectedAccountId, setSelectedAccountId] = useState('');

  const fetchAccounts = async () => {
    try {
      const res = await fetch('/api/v1/social/accounts');
      if (res.ok) {
        const data = await res.json();
        setAccounts(data.accounts || []);
      }
    } catch {
      toast.error('Failed to load accounts');
    }
  };

  const fetchDrafts = async () => {
    try {
      const res = await fetch('/api/v1/social/content');
      if (res.ok) {
        const data = await res.json();
        setDrafts(data.content || []);
      }
    } catch {
      toast.error('Failed to load drafts');
    }
  };

  useEffect(() => {
    Promise.all([fetchAccounts(), fetchDrafts()]).finally(() => setIsLoading(false));
  }, []);

  const handleAddAccount = async () => {
    const name = prompt('Enter account name for testing:');
    if (!name) return;
    try {
      const res = await fetch('/api/v1/social/accounts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ platform: selectedPlatform, accountName: name }),
      });
      if (res.ok) {
        toast.success('Account added');
        fetchAccounts();
      }
    } catch {
      toast.error('Failed to add account');
    }
  };

  const handleCreateDraft = async () => {
    if (!draftText || !selectedAccountId) {
      toast.error('Please enter text and select an account');
      return;
    }
    const acc = accounts.find((a) => a.id === selectedAccountId);
    if (!acc) return;

    try {
      const res = await fetch('/api/v1/social/content', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ platform: acc.platform, accountId: acc.id, text: draftText }),
      });
      if (res.ok) {
        toast.success('Draft created');
        setDraftText('');
        fetchDrafts();
      }
    } catch {
      toast.error('Failed to create draft');
    }
  };

  const handlePublish = async (id: string) => {
    try {
      const res = await fetch('/api/v1/social/content/' + id + '/publish', {
        method: 'POST',
      });
      if (res.ok) {
        const data = await res.json();
        if (data.success) {
          toast.success('Published successfully');
        } else {
          toast.error('Publish failed: ' + data.result.error);
        }
        fetchDrafts();
      }
    } catch {
      toast.error('Publish request failed');
    }
  };

  return (
    <div className="flex flex-col h-full bg-bg-primary dark:bg-dark-bg-primary text-text-primary dark:text-dark-text-primary">
      <header className="flex items-center justify-between px-6 py-4 border-b border-border dark:border-dark-border bg-bg-secondary dark:bg-dark-bg-secondary">
        <div className="flex items-center gap-3">
          <Share2 className="w-5 h-5 text-accent" />
          <div>
            <h2 className="text-lg font-semibold text-text-primary dark:text-dark-text-primary">
              Social Automation
            </h2>
            <p className="text-sm text-text-muted dark:text-dark-text-muted">
              Manage multi-platform social accounts, drafts, and scheduling.
            </p>
          </div>
        </div>
      </header>

      <div className="flex border-b border-border dark:border-dark-border px-6 mt-2">
        {['accounts', 'drafts', 'published'].map((t) => (
          <button
            key={t}
            onClick={() => setSearchParams({ tab: t })}
            className={
              'px-4 py-2 font-medium text-sm border-b-2 ' +
              (tab === t
                ? 'border-accent text-accent'
                : 'border-transparent text-text-secondary hover:text-text-primary')
            }
          >
            {t.charAt(0).toUpperCase() + t.slice(1)}
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-auto p-6">
        {tab === 'accounts' && (
          <div>
            <div className="flex justify-between items-center mb-4">
              <h3 className="text-lg font-medium">Connected Accounts</h3>
              <div className="flex gap-2">
                <select
                  className="bg-bg-tertiary border border-border rounded px-2 py-1"
                  value={selectedPlatform}
                  onChange={(e) => setSelectedPlatform(e.target.value)}
                >
                  <option value="instagram">Instagram</option>
                  <option value="tiktok">TikTok</option>
                  <option value="youtube">YouTube</option>
                </select>
                <button
                  onClick={handleAddAccount}
                  className="flex items-center gap-1 bg-accent text-white px-3 py-1 rounded hover:opacity-90"
                >
                  <Plus className="w-4 h-4" /> Add Account
                </button>
              </div>
            </div>
            {accounts.length === 0 ? (
              <div className="p-8 text-center text-text-muted border border-dashed rounded-lg border-border">
                No accounts connected.
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {accounts.map((a) => (
                  <div
                    key={a.id}
                    className="p-4 rounded-lg border border-border bg-bg-secondary flex justify-between items-center"
                  >
                    <div>
                      <div className="font-medium">{a.accountName}</div>
                      <div className="text-xs text-text-muted capitalize">
                        {a.platform} &middot; {a.status}
                      </div>
                    </div>
                    <Globe className="w-5 h-5 text-accent opacity-50" />
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {tab === 'drafts' && (
          <div className="flex flex-col gap-6">
            <div className="bg-bg-secondary border border-border rounded-lg p-4">
              <h3 className="text-lg font-medium mb-3">Create Draft</h3>
              <textarea
                className="w-full bg-bg-tertiary border border-border rounded-lg p-3 min-h-[100px] mb-3"
                placeholder="What do you want to share?"
                value={draftText}
                onChange={(e) => setDraftText(e.target.value)}
              />
              <div className="flex gap-3 items-center">
                <select
                  className="bg-bg-tertiary border border-border rounded px-2 py-1"
                  value={selectedAccountId}
                  onChange={(e) => setSelectedAccountId(e.target.value)}
                >
                  <option value="">Select Account...</option>
                  {accounts.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.accountName} ({a.platform})
                    </option>
                  ))}
                </select>
                <button
                  onClick={handleCreateDraft}
                  className="flex items-center gap-1 bg-accent text-white px-4 py-1.5 rounded hover:opacity-90"
                >
                  <PenTool className="w-4 h-4" /> Save Draft
                </button>
              </div>
            </div>

            <div>
              <h3 className="text-lg font-medium mb-3">Your Drafts & Pending</h3>
              <div className="flex flex-col gap-3">
                {drafts
                  .filter(
                    (d) =>
                      d.status === 'draft' || d.status === 'failed' || d.status === 'publishing'
                  )
                  .map((d) => (
                    <div key={d.id} className="p-4 rounded-lg border border-border bg-bg-secondary">
                      <div className="flex justify-between items-start mb-2">
                        <div className="font-medium text-sm">{d.platform}</div>
                        <div className="text-xs px-2 py-0.5 rounded bg-bg-tertiary text-text-secondary">
                          {d.status}
                        </div>
                      </div>
                      <p className="text-sm mb-3">{d.text}</p>
                      {d.errorMessage && (
                        <p className="text-xs text-error mb-3">Error: {d.errorMessage}</p>
                      )}
                      <div className="flex gap-2">
                        <button
                          onClick={() => handlePublish(d.id)}
                          className="text-xs px-3 py-1 bg-accent/10 text-accent rounded hover:bg-accent/20"
                        >
                          Publish Now
                        </button>
                      </div>
                    </div>
                  ))}
              </div>
            </div>
          </div>
        )}

        {tab === 'published' && (
          <div>
            <h3 className="text-lg font-medium mb-4">Published & Scheduled Content</h3>
            <div className="flex flex-col gap-3">
              {drafts
                .filter((d) => d.status === 'published' || d.status === 'scheduled')
                .map((d) => (
                  <div
                    key={d.id}
                    className="p-4 rounded-lg border border-border bg-bg-secondary flex justify-between items-center"
                  >
                    <div>
                      <div className="font-medium text-sm mb-1">
                        {d.platform} &middot; {d.status}
                      </div>
                      <p className="text-sm text-text-muted line-clamp-1">{d.text}</p>
                    </div>
                    {d.publishedUrl && (
                      <a
                        href={d.publishedUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="text-accent text-sm hover:underline"
                      >
                        View Post
                      </a>
                    )}
                  </div>
                ))}
              {drafts.filter((d) => d.status === 'published' || d.status === 'scheduled').length ===
                0 && (
                <div className="p-8 text-center text-text-muted border border-dashed rounded-lg border-border">
                  No published content yet.
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
