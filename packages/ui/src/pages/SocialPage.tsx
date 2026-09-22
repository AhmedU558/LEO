export const SocialPage = () => {
  const { session } = useAuth();
  const [accounts, setAccounts] = useState<unknown[]>([]);
  const [campaigns, setCampaigns] = useState<unknown[]>([]);

  const [draftTitle, setDraftTitle] = useState('');
  const [draftText, setDraftText] = useState('');
  const [draftTags, setDraftTags] = useState('');
  const [draftPrivacy] = useState('public');
  const [selectedAccounts, setSelectedAccounts] = useState<string[]>([]);
  const [uploading, setUploading] = useState(false);
  const [uploadedMediaId, setUploadedMediaId] = useState<string | null>(null);

  useEffect(() => {
    fetchAccounts();
    fetchCampaigns();
  }, [session]);

  const fetchAccounts = async () => {
    try {
      const res = await fetch('/api/v1/social/accounts');
      const data = await res.json();
      setAccounts(data.data || []);
    } catch {
      console.error(e);
    }
  };

  const fetchCampaigns = async () => {
    try {
      const res = await fetch('/api/v1/social/campaigns');
      const data = await res.json();
      setCampaigns(data.data || []);
    } catch {
      console.error(e);
    }
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setUploading(true);
    const formData = new FormData();
    formData.append('file', file);

    try {
      const res = await fetch('/api/v1/media/upload', {
        method: 'POST',
        body: formData,
      });

      if (!res.ok) throw new Error('Upload failed');
      const data = await res.json();
      setUploadedMediaId(data.data.id);
      toast.success('Media uploaded successfully');
    } catch (error) {
      toast.error('Failed to upload media');
      console.error(error);
    } finally {
      setUploading(false);
    }
  };

  const handleCreateCampaign = async () => {
    if (!draftText || selectedAccounts.length === 0) {
      toast.error('Please enter text and select at least one account');
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

      // 2. Create platform variants for all selected platforms
      const selectedPlatforms = new Set(
        selectedAccounts.map((id) => accounts.find((a) => a.id === id)?.platform).filter(Boolean)
      );

      for (const platform of selectedPlatforms) {
        await fetch(`/api/v1/content/${content.id}/variants/${platform}`, {
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
      }

      // 3. Create Campaign
      const campRes = await fetch('/api/v1/social/campaigns', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contentItemId: content.id,
          accountIds: selectedAccounts,
        }),
      });

      if (!campRes.ok) throw new Error('Failed to create campaign');

      toast.success('Campaign created successfully');
      setDraftTitle('');
      setDraftText('');
      setDraftTags('');
      setSelectedAccounts([]);
      setUploadedMediaId(null);
      fetchCampaigns();
    } catch (error) {
      toast.error('Failed to create campaign');
      console.error(error);
    }
  };

  const handleCancelCampaign = async (id: string) => {
    try {
      await fetch(`/api/v1/social/campaigns/${id}/cancel`, { method: 'POST' });
      toast.success('Campaign cancelled');
      fetchCampaigns();
    } catch {
      toast.error('Failed to cancel campaign');
    }
  };

  const handleReconcileCampaign = async (id: string) => {
    try {
      await fetch(`/api/v1/social/campaigns/${id}/reconcile`, { method: 'POST' });
      toast.success('Campaign reconciled');
      fetchCampaigns();
    } catch {
      toast.error('Failed to reconcile campaign');
    }
  };

  const toggleAccount = (id: string) => {
    if (selectedAccounts.includes(id)) {
      setSelectedAccounts(selectedAccounts.filter((a) => a !== id));
    } else {
      setSelectedAccounts([...selectedAccounts, id]);
    }
  };

  return (
    <PageContainer title="Social Publishing">
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-1 space-y-6">
          <Card title="Connected Accounts">
            <div className="space-y-4">
              {accounts.length > 0 ? (
                accounts.map((acc) => (
                  <div
                    key={acc.id}
                    className="flex items-center justify-between p-3 rounded-lg border border-border bg-bg-secondary"
                  >
                    <div>
                      <p className="font-medium text-text-primary">{acc.accountName}</p>
                      <p className="text-xs text-text-tertiary capitalize">{acc.platform}</p>
                    </div>
                    <span className="text-xs px-2 py-1 bg-success/10 text-success rounded-full">
                      Active
                    </span>
                  </div>
                ))
              ) : (
                <p className="text-sm text-text-tertiary text-center py-4">
                  No accounts connected yet.
                </p>
              )}

              <div className="pt-4 border-t border-border grid grid-cols-2 gap-2">
                <a
                  href="/api/v1/social/youtube/connect"
                  className="text-center py-2 bg-red-600/10 text-red-500 rounded-lg text-xs font-medium"
                >
                  YouTube
                </a>
                <a
                  href="/api/v1/social/instagram/connect"
                  className="text-center py-2 bg-pink-600/10 text-pink-500 rounded-lg text-xs font-medium"
                >
                  Instagram
                </a>
                <a
                  href="/api/v1/social/facebook/connect"
                  className="text-center py-2 bg-blue-600/10 text-blue-500 rounded-lg text-xs font-medium"
                >
                  Facebook
                </a>
                <a
                  href="/api/v1/social/tiktok/connect"
                  className="text-center py-2 bg-black/10 text-black dark:text-white dark:bg-white/10 rounded-lg text-xs font-medium"
                >
                  TikTok
                </a>
              </div>
            </div>
          </Card>

          <Card title="New Campaign">
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-text-secondary mb-2">
                  Target Accounts
                </label>
                <div className="space-y-2 max-h-40 overflow-y-auto border border-border rounded-lg p-2">
                  {accounts.map((acc) => (
                    <label
                      key={acc.id}
                      className="flex items-center space-x-2 p-2 hover:bg-bg-secondary rounded cursor-pointer"
                    >
                      <input
                        type="checkbox"
                        checked={selectedAccounts.includes(acc.id)}
                        onChange={() => toggleAccount(acc.id)}
                      />
                      <span className="text-sm">
                        {acc.accountName} ({acc.platform})
                      </span>
                    </label>
                  ))}
                </div>
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
                  className="w-full text-sm file:mr-4 file:py-2 file:px-4 file:rounded-lg file:border-0 file:bg-accent/10 file:text-accent hover:file:bg-accent/20 cursor-pointer disabled:opacity-50"
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
                  placeholder="Optional"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-text-secondary mb-2">
                  Content / Caption
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
                />
              </div>

              <button
                onClick={handleCreateCampaign}
                className="w-full py-3 bg-accent text-white rounded-lg hover:bg-accent/90 transition-colors font-medium"
              >
                Create Campaign
              </button>
            </div>
          </Card>
        </div>

        <div className="lg:col-span-2 space-y-6">
          <Card title="Publishing Campaigns">
            <div className="space-y-4">
              {campaigns.map((camp) => (
                <div key={camp.id} className="p-4 rounded-lg border border-border bg-bg-secondary">
                  <div className="flex items-start justify-between mb-4">
                    <div>
                      <p className="font-medium text-text-primary">Campaign: {camp.id}</p>
                      <p className="text-xs text-text-tertiary">
                        Created: {new Date(camp.createdAt).toLocaleString()}
                      </p>
                    </div>
                    <span
                      className={`px-2 py-1 text-xs rounded-full bg-bg-tertiary text-text-secondary`}
                    >
                      {camp.status}
                    </span>
                  </div>
                  <div className="flex gap-2 mb-2">
                    {camp.status !== 'CANCELLED' && camp.status !== 'PUBLISHED' && (
                      <button
                        onClick={() => handleCancelCampaign(camp.id)}
                        className="text-xs px-3 py-1 bg-error/10 text-error rounded hover:bg-error/20"
                      >
                        Cancel
                      </button>
                    )}
                    {(camp.status === 'NEEDS_RECONCILIATION' || camp.status === 'UNKNOWN') && (
                      <button
                        onClick={() => handleReconcileCampaign(camp.id)}
                        className="text-xs px-3 py-1 bg-warning/10 text-warning rounded hover:bg-warning/20"
                      >
                        Reconcile
                      </button>
                    )}
                  </div>
                </div>
              ))}
              {campaigns.length === 0 && (
                <p className="text-sm text-text-tertiary text-center py-8">
                  No campaigns available.
                </p>
              )}
            </div>
          </Card>
        </div>
      </div>
    </PageContainer>
  );
};
