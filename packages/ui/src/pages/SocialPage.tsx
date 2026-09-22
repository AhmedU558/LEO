import React, { useEffect, useState } from 'react';
import { PageContainer } from '../components/PageContainer';
import { Card } from '../components/Card';
import { toast } from 'react-hot-toast';
import type { SocialAccount, PublishRequest } from '../types/leo';

export const SocialPage: React.FC = () => {
  const [accounts, setAccounts] = useState<SocialAccount[]>([]);
  const [drafts, setDrafts] = useState<PublishRequest[]>([]);
  const [draftText, setDraftText] = useState('');
  const [draftTitle, setDraftTitle] = useState('');
  const [draftTags, setDraftTags] = useState('');
  const [draftPrivacy, setDraftPrivacy] = useState('private');
  const [selectedAccountId, setSelectedAccountId] = useState('');
  const [uploading, setUploading] = useState(false);
  const [uploadedMediaId, setUploadedMediaId] = useState<string | null>(null);

  useEffect(() => {
    fetchAccounts();
    fetchDrafts();
  }, []);

  const fetchAccounts = async () => {
    try {
      const res = await fetch('/api/v1/social/accounts');
      if (res.ok) {
        const data = await res.json();
        setAccounts(data.accounts || []);
      }
    } catch {
      toast.error('Failed to fetch accounts');
    }
  };

  const fetchDrafts = async () => {
    try {
      const res = await fetch('/api/v1/social/publish');
      if (res.ok) {
        const data = await res.json();
        setDrafts(data.requests || []);
      }
    } catch {
      toast.error('Failed to fetch drafts');
    }
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const formData = new FormData();
    formData.append('file', file);

    setUploading(true);
    try {
      const res = await fetch('/api/v1/media/upload', {
        method: 'POST',
        body: formData,
      });
      if (res.ok) {
        const data = await res.json();
        setUploadedMediaId(data.id);
        toast.success('Media uploaded successfully');
      } else {
        const err = await res.json();
        toast.error(err.error?.message || 'Upload failed');
      }
    } catch {
      toast.error('Upload failed');
    } finally {
      setUploading(false);
    }
  };

  const handleCreateContent = async () => {
    if (!draftText || !selectedAccountId) {
      toast.error('Please enter text and select an account');
      return;
    }
    const acc = accounts.find((a) => a.id === selectedAccountId);
    if (!acc) return;

    if (acc.platform === 'youtube' && !draftTitle) {
      toast.error('YouTube requires a title');
      return;
    }

    if (acc.platform === 'youtube' && !uploadedMediaId) {
      toast.error('YouTube requires uploaded media');
      return;
    }

    try {
      // 1. Create content item
      const contentRes = await fetch('/api/v1/content', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: draftTitle,
          description: draftText,
          hashtags: draftTags
            .split(',')
            .map((t) => t.trim())
            .filter(Boolean),
          mediaAssetIds: uploadedMediaId ? [uploadedMediaId] : [],
        }),
      });

      if (!contentRes.ok) throw new Error('Failed to create content');
      const content = await contentRes.json();

      // 2. Create platform variant
      const variantRes = await fetch(`/api/v1/content/${content.id}/variants/${acc.platform}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: draftTitle,
          description: draftText,
          hashtags: draftTags
            .split(',')
            .map((t) => t.trim())
            .filter(Boolean),
          privacyStatus: draftPrivacy,
        }),
      });

      if (!variantRes.ok) throw new Error('Failed to create variant');

      // 3. To maintain backward compatibility with SocialPage's publish loop,
      // create a publish request mapped to this content.
      // Wait, let's just use the legacy /social/publish endpoint for now, but pass media Asset
      const res = await fetch('/api/v1/social/publish', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          platform: acc.platform,
          accountId: acc.id,
          title: draftTitle,
          text: draftText,
          hashtags: draftTags
            .split(',')
            .map((t) => t.trim())
            .filter(Boolean),
          mediaAssetIds: uploadedMediaId ? [uploadedMediaId] : [], // Use the ID!
          metadata: { privacyStatus: draftPrivacy, contentId: content.id },
        }),
      });

      if (res.ok) {
        toast.success('Draft created');
        setDraftText('');
        setDraftTitle('');
        setDraftTags('');
        setUploadedMediaId(null);
        fetchDrafts();
      } else {
        throw new Error('Failed to create publish request');
      }
    } catch (err: unknown) {
      toast.error((err as Error).message || 'Failed to create content');
    }
  };

  const handlePublish = async (id: string) => {
    try {
      const res = await fetch('/api/v1/social/publish/' + id + '/publish', {
        method: 'POST',
      });
      if (res.ok) {
        toast.success('Publishing initiated');
        fetchDrafts();
      }
    } catch {
      toast.error('Failed to initiate publish');
    }
  };

  return (
    <PageContainer title="Social & Mission Control">
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-1 space-y-6">
          <Card title="Connected Accounts">
            <div className="space-y-4">
              {accounts.map((acc) => (
                <div
                  key={acc.id}
                  className="p-4 rounded-lg border border-border bg-bg-secondary flex items-center justify-between"
                >
                  <div>
                    <p className="font-medium text-text-primary">{acc.accountName}</p>
                    <p className="text-xs text-text-tertiary capitalize">{acc.platform}</p>
                  </div>
                  <span
                    className={`px-2 py-1 text-xs rounded-full ${
                      acc.status === 'active'
                        ? 'bg-success/10 text-success'
                        : 'bg-error/10 text-error'
                    }`}
                  >
                    {acc.status}
                  </span>
                </div>
              ))}
              {accounts.length === 0 && (
                <p className="text-sm text-text-tertiary">No accounts connected yet.</p>
              )}

              <div className="pt-4 border-t border-border">
                <a
                  href="/api/v1/social/youtube/connect"
                  className="w-full inline-block text-center py-2 bg-red-600/10 text-red-500 rounded-lg hover:bg-red-600/20 transition-colors text-sm font-medium"
                >
                  Connect YouTube
                </a>
              </div>
            </div>
          </Card>

          <Card title="Compose">
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-text-secondary mb-2">
                  Account
                </label>
                <select
                  value={selectedAccountId}
                  onChange={(e) => setSelectedAccountId(e.target.value)}
                  className="w-full bg-bg-tertiary border border-border rounded-lg p-3"
                >
                  <option value="">Select an account...</option>
                  {accounts.map((acc) => (
                    <option key={acc.id} value={acc.id}>
                      {acc.accountName} ({acc.platform})
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-text-secondary mb-2">
                  Media Upload
                </label>
                <input
                  type="file"
                  onChange={handleFileUpload}
                  disabled={uploading}
                  accept="video/*,image/*"
                  className="w-full bg-bg-tertiary border border-border rounded-lg p-3 text-sm text-text-secondary file:mr-4 file:py-2 file:px-4 file:rounded-full file:border-0 file:text-sm file:font-semibold file:bg-accent/10 file:text-accent hover:file:bg-accent/20 cursor-pointer disabled:opacity-50"
                />
                {uploadedMediaId && (
                  <p className="text-xs text-success mt-2">Media ready: {uploadedMediaId}</p>
                )}
              </div>

              <div>
                <label className="block text-sm font-medium text-text-secondary mb-2">Title</label>
                <input
                  type="text"
                  value={draftTitle}
                  onChange={(e) => setDraftTitle(e.target.value)}
                  className="w-full bg-bg-tertiary border border-border rounded-lg p-3"
                  placeholder="Required for YouTube"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-text-secondary mb-2">
                  Content / Description
                </label>
                <textarea
                  value={draftText}
                  onChange={(e) => setDraftText(e.target.value)}
                  className="w-full bg-bg-tertiary border border-border rounded-lg p-3 min-h-[100px]"
                  placeholder="What do you want to share?"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-text-secondary mb-2">
                  Tags (comma separated)
                </label>
                <input
                  type="text"
                  value={draftTags}
                  onChange={(e) => setDraftTags(e.target.value)}
                  className="w-full bg-bg-tertiary border border-border rounded-lg p-3"
                  placeholder="e.g. vlog, gaming, tech"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-text-secondary mb-2">
                  Privacy Status
                </label>
                <select
                  value={draftPrivacy}
                  onChange={(e) => setDraftPrivacy(e.target.value)}
                  className="w-full bg-bg-tertiary border border-border rounded-lg p-3"
                >
                  <option value="private">Private</option>
                  <option value="unlisted">Unlisted</option>
                  <option value="public">Public</option>
                </select>
              </div>

              <button
                onClick={handleCreateContent}
                className="w-full py-3 bg-accent text-white rounded-lg hover:bg-accent/90 transition-colors font-medium"
              >
                Save as Draft
              </button>
            </div>
          </Card>
        </div>

        <div className="lg:col-span-2 space-y-6">
          <Card title="Drafts & Pending">
            <div className="space-y-4">
              {drafts
                .filter(
                  (d) =>
                    d.status === 'pending' ||
                    d.status === 'failed' ||
                    d.status === 'publishing' ||
                    d.status === 'unknown'
                )
                .map((d) => (
                  <div key={d.id} className="p-4 rounded-lg border border-border bg-bg-secondary">
                    <div className="flex items-start justify-between mb-2">
                      <div>
                        <p className="font-medium text-text-primary capitalize">{d.platform}</p>
                        <p className="text-xs text-text-tertiary">
                          Created: {new Date(d.createdAt).toLocaleString()}
                        </p>
                      </div>
                      <span
                        className={`px-2 py-1 text-xs rounded-full ${
                          d.status === 'publishing'
                            ? 'bg-warning/10 text-warning'
                            : d.status === 'failed'
                              ? 'bg-error/10 text-error'
                              : 'bg-bg-tertiary text-text-secondary'
                        }`}
                      >
                        {d.status}
                      </span>
                    </div>
                    {/* Access postId to fetch SocialPost details, though legacy UI didn't do this easily. We can just display minimal details */}
                    <div className="flex gap-2 mt-4">
                      {d.status === 'unknown' && (
                        <button
                          onClick={async () => {
                            await fetch(`/api/v1/social/publish/${d.id}/reconcile`, {
                              method: 'POST',
                            });
                            fetchDrafts();
                          }}
                          className="text-xs px-3 py-1 bg-yellow-500/10 text-yellow-500 rounded hover:bg-yellow-500/20"
                        >
                          Reconcile
                        </button>
                      )}
                      <button
                        onClick={() => handlePublish(d.id)}
                        className="text-xs px-3 py-1 bg-accent/10 text-accent rounded hover:bg-accent/20"
                      >
                        Publish Now
                      </button>
                    </div>
                  </div>
                ))}
              {drafts.filter(
                (d) =>
                  d.status === 'pending' ||
                  d.status === 'failed' ||
                  d.status === 'publishing' ||
                  d.status === 'unknown'
              ).length === 0 && (
                <p className="text-sm text-text-tertiary text-center py-8">
                  No drafts available. Create one to get started.
                </p>
              )}
            </div>
          </Card>
        </div>
      </div>
    </PageContainer>
  );
};
