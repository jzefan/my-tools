import React, { useState, useEffect, useRef } from 'react';
import { AiProviderConfig } from '../../types/paper';
import { requestCompletion } from '../../utils/paperAi';
import { paperApi } from '../../services/paperApi';
import { Settings, Check, X, RefreshCw } from 'lucide-react';

interface PaperSettingsModalProps {
  config: AiProviderConfig;
  isOpen: boolean;
  onClose: () => void;
  onSave: (newConfig: AiProviderConfig) => void;
}

const PROVIDER_PRESETS: Record<
  string,
  { label: string; endpoint: string; defaultModel: string }
> = {
  deepseek: {
    label: 'DeepSeek (深度求索)',
    endpoint: 'https://api.deepseek.com/v1',
    defaultModel: 'deepseek-flash',
  },
  qwen: {
    label: '通义千问 (DashScope / 百炼)',
    endpoint: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    defaultModel: 'qwen3.7-plus',
  },
  siliconflow: {
    label: 'SiliconFlow (硅基流动)',
    endpoint: 'https://api.siliconflow.cn/v1',
    defaultModel: 'deepseek-ai/DeepSeek-V3',
  },
  openai: {
    label: 'OpenAI (官方或兼容代理)',
    endpoint: 'https://api.openai.com/v1',
    defaultModel: 'gpt-4o',
  },
  custom: {
    label: '自定义兼容端点',
    endpoint: '',
    defaultModel: '',
  },
};

export const PaperSettingsModal: React.FC<PaperSettingsModalProps> = ({
  config,
  isOpen,
  onClose,
  onSave,
}) => {
  const [provider, setProvider] = useState<AiProviderConfig['provider']>(config.provider);
  const [apiKey, setApiKey] = useState(config.apiKey);
  const [endpoint, setEndpoint] = useState(config.endpoint);
  const [model, setModel] = useState(config.model);
  const [temperature, setTemperature] = useState(config.temperature);
  const [testStatus, setTestStatus] = useState<'idle' | 'testing' | 'success' | 'error'>('idle');
  const [testMsg, setTestMsg] = useState('');

  const providerRequest = useRef(0);
  const testController = useRef<AbortController | null>(null);
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    if (!isOpen) return;
    setProvider(config.provider); setApiKey(config.apiKey); setEndpoint(config.endpoint);
    setModel(config.model); setTemperature(config.temperature); setTestStatus('idle'); setTestMsg('');
    return () => { providerRequest.current++; testController.current?.abort(); };
  }, [isOpen, config]);
  if (!isOpen) return null;

  const handleProviderChange = async (p: AiProviderConfig['provider']) => {
    testController.current?.abort(); setTestStatus('idle');
    const request = ++providerRequest.current;
    setProvider(p); setApiKey('');
    const preset = PROVIDER_PRESETS[p];
    if (preset) {
      if (preset.endpoint) setEndpoint(preset.endpoint);
      if (preset.defaultModel) setModel(preset.defaultModel);
    }
    const saved = await paperApi.providerConfig(p);
    if (request === providerRequest.current && saved) { setApiKey(saved.apiKey); setEndpoint(saved.endpoint); setModel(saved.model); setTemperature(saved.temperature); }
  };

  const handleSave = async () => {
    if (saving) return;
    setSaving(true);
    const newCfg: AiProviderConfig = {
      provider,
      apiKey: apiKey.trim(),
      endpoint: endpoint.trim(),
      model: model.trim(),
      temperature,
    };
    try {
      const url = new URL(newCfg.endpoint);
      if (url.protocol !== 'https:' || url.username || url.password || !newCfg.model) throw new Error('请填写有效的 HTTPS 地址与模型');
      onSave(await paperApi.saveAiConfig(newCfg));
      onClose();
    } catch (error) { setTestStatus('error'); setTestMsg(error instanceof Error ? error.message : String(error)); }
    finally { setSaving(false); }
  };

  const handleTestConnection = async () => {
    if (!endpoint || !apiKey) {
      setTestStatus('error');
      setTestMsg('请填写端点与密钥');
      return;
    }

    setTestStatus('testing');
    setTestMsg('');
    testController.current?.abort();
    const controller = new AbortController(); testController.current = controller;
    try {
      await requestCompletion({ provider, apiKey, endpoint, model, temperature }, [{ role: 'user', content: 'Hi' }], false,
        { signal: controller.signal, maximumOutputTokens: 5, timeoutMs: 15000 });
      if (!controller.signal.aborted) { setTestStatus('success'); setTestMsg('连接成功'); }
    } catch (error) {
      if (!controller.signal.aborted) { setTestStatus('error'); setTestMsg(error instanceof Error ? error.message : String(error)); }
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-xs p-4">
      <div className="w-full max-w-md bg-white dark:bg-slate-900 rounded-2xl shadow-2xl border border-slate-200 dark:border-slate-800 p-5 space-y-4 animate-pop-in">
        {/* Title */}
        <div className="flex items-center justify-between pb-3 border-b border-slate-100 dark:border-slate-800">
          <div className="flex items-center space-x-2">
            <Settings className="w-4 h-4 text-indigo-500" />
            <span className="text-sm font-bold text-slate-800 dark:text-slate-100">
              AI 设置
            </span>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1 rounded text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Form Fields */}
        <div className="space-y-3 text-xs">
          <div>
            <label className="block text-slate-600 dark:text-slate-400 font-medium mb-1">
              服务商:
            </label>
            <select
              value={provider}
              onChange={(e) => handleProviderChange(e.target.value as any)}
              className="w-full p-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-800 dark:text-slate-200 focus:outline-hidden"
            >
              {Object.entries(PROVIDER_PRESETS).map(([k, v]) => (
                <option key={k} value={k}>
                  {v.label}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-slate-600 dark:text-slate-400 font-medium mb-1">
              API 端点:
            </label>
            <input
              type="text"
              value={endpoint}
              onChange={(e) => setEndpoint(e.target.value)}
              placeholder="https://api.deepseek.com/v1"
              className="w-full p-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-800 dark:text-slate-200 font-mono text-xs focus:outline-hidden"
            />
          </div>

          <div>
            <label className="block text-slate-600 dark:text-slate-400 font-medium mb-1">
              API 密钥:
            </label>
            <input
              type="password"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder="sk-..."
              className="w-full p-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-800 dark:text-slate-200 font-mono text-xs focus:outline-hidden"
            />
            <span className="text-[10px] text-slate-400 mt-0.5 block">
              密钥仅保存在本机
            </span>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="block text-slate-600 dark:text-slate-400 font-medium mb-1">
                模型名称:
              </label>
              <input
                type="text"
                value={model}
                onChange={(e) => setModel(e.target.value)}
                placeholder="deepseek-chat"
                className="w-full p-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-800 dark:text-slate-200 font-mono text-xs focus:outline-hidden"
              />
            </div>

            <div>
              <label className="block text-slate-600 dark:text-slate-400 font-medium mb-1">
                采样温度 (Temperature):
              </label>
              <input
                type="number"
                step={0.1}
                min={0}
                max={1}
                value={temperature}
                onChange={(e) => setTemperature(Number.isFinite(e.target.valueAsNumber) ? e.target.valueAsNumber : 0.3)}
                className="w-full p-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-800 dark:text-slate-200 font-mono text-xs focus:outline-hidden"
              />
            </div>
          </div>

          <p className="text-[11px] text-slate-400">{config.keyPersistence === 'system' ? '密钥已存入系统凭据' : config.keyPersistence === 'session' ? '密钥仅用于本次会话' : ''}</p>
          {/* Test Status Feedback */}
          {testStatus !== 'idle' && (
            <div
              className={`p-2 rounded-xl text-xs flex items-center space-x-1.5 ${
                testStatus === 'testing'
                  ? 'bg-slate-100 text-slate-600'
                  : testStatus === 'success'
                  ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300'
                  : 'bg-rose-50 text-rose-700 dark:bg-rose-950/40 dark:text-rose-300'
              }`}
            >
              {testStatus === 'testing' ? (
                <RefreshCw className="w-3.5 h-3.5 animate-spin" />
              ) : testStatus === 'success' ? (
                <Check className="w-3.5 h-3.5" />
              ) : (
                <X className="w-3.5 h-3.5" />
              )}
              <span className="truncate">{testMsg}</span>
            </div>
          )}
        </div>

        {/* Footer Actions */}
        <div className="pt-2 border-t border-slate-100 dark:border-slate-800 flex items-center justify-between">
          <button
            type="button"
            onClick={handleTestConnection}
            disabled={testStatus === 'testing'}
            className="px-3 py-1.5 rounded-xl border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-300 text-xs font-medium cursor-pointer"
          >
            测试连接
          </button>

          <div className="flex items-center space-x-2">
            <button
              type="button"
              onClick={onClose}
              className="px-3 py-1.5 rounded-xl text-slate-400 hover:text-slate-600 text-xs cursor-pointer"
            >
              取消
            </button>
            <button
              type="button"
              disabled={saving}
              onClick={handleSave}
              className="px-4 py-1.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold shadow-xs cursor-pointer"
            >
              保存
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
