import React, { useState, useEffect } from 'react';
import {
  Sparkles,
  Search,
  RefreshCw,
  Plus,
  X,
  Layers,
  Tag,
  ShieldCheck,
  Check,
} from 'lucide-react';
import { api } from '../services/api';
import { OperationResult, WatermarkAnalysis, WatermarkCandidate } from '../types';
import { generateDefaultOutputPath } from '../utils/format';
import { OperationStatusBanner } from './common/OperationStatusBanner';

interface WatermarkViewProps {
  initialFile?: string;
}

export const WatermarkView: React.FC<WatermarkViewProps> = ({ initialFile }) => {
  const [inputPath, setInputPath] = useState(initialFile || '');
  const [outputPath, setOutputPath] = useState('');

  // Scanning & Analysis
  const [isScanning, setIsScanning] = useState(false);
  const [analysis, setAnalysis] = useState<WatermarkAnalysis | null>(null);

  // Targets to remove
  const [targetTexts, setTargetTexts] = useState<string[]>([]);
  const [targetXObjects, setTargetXObjects] = useState<string[]>([]);
  const [newTextCustom, setNewTextCustom] = useState('');
  const [removeAnnotations, setRemoveAnnotations] = useState(true);
  const [caseSensitive, setCaseSensitive] = useState(false);

  // Operation execution
  const [isRemoving, setIsRemoving] = useState(false);
  const [result, setResult] = useState<OperationResult | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    if (initialFile) {
      handleSelectFile(initialFile);
    }
  }, [initialFile]);

  const handleSelectFile = (path: string) => {
    setInputPath(path);
    setOutputPath(generateDefaultOutputPath(path, 'clean'));
    setAnalysis(null);
    setTargetTexts([]);
    setTargetXObjects([]);
    setResult(null);
    setErrorMessage(null);
  };

  // Perform auto-scan
  const handleAutoScan = async () => {
    if (!inputPath.trim()) {
      setErrorMessage('请先输入或选择需要扫描水印的 PDF 文件');
      return;
    }

    setIsScanning(true);
    setErrorMessage(null);

    try {
      const data = await api.analyzeWatermarks(inputPath.trim());
      setAnalysis(data);

      // Automatically select detected candidates with high confidence
      const detected = data.text_watermarks.map((c) => c.text);
      setTargetTexts(detected);
      setTargetXObjects(data.xobject_watermarks);
    } catch (err: any) {
      setErrorMessage(typeof err === 'string' ? err : err?.message || '水印扫描失败');
    } finally {
      setIsScanning(false);
    }
  };

  // Add custom text
  const addCustomText = () => {
    const text = newTextCustom.trim();
    if (text && !targetTexts.includes(text)) {
      setTargetTexts([...targetTexts, text]);
      setNewTextCustom('');
    }
  };

  const removeTargetText = (text: string) => {
    setTargetTexts(targetTexts.filter((t) => t !== text));
  };

  const toggleCandidate = (candidate: WatermarkCandidate) => {
    if (targetTexts.includes(candidate.text)) {
      removeTargetText(candidate.text);
    } else {
      setTargetTexts([...targetTexts, candidate.text]);
    }
  };

  const toggleXObject = (name: string) => {
    if (targetXObjects.includes(name)) {
      setTargetXObjects(targetXObjects.filter((x) => x !== name));
    } else {
      setTargetXObjects([...targetXObjects, name]);
    }
  };

  // Execute Watermark Removal
  const handleRemoveWatermarks = async () => {
    if (!inputPath.trim()) {
      setErrorMessage('请选择 PDF 文件');
      return;
    }
    if (targetTexts.length === 0 && targetXObjects.length === 0 && !removeAnnotations) {
      setErrorMessage('请至少添加或勾选一个需要去除的水印关键词或图层');
      return;
    }
    if (!outputPath.trim()) {
      setErrorMessage('请指定去水印后的输出路径');
      return;
    }

    setIsRemoving(true);
    setErrorMessage(null);
    setResult(null);

    const startTime = Date.now();
    try {
      const res = await api.removeWatermarks({
        input_path: inputPath.trim(),
        output_path: outputPath.trim(),
        target_texts: targetTexts,
        target_xobjects: targetXObjects,
        remove_annotations: removeAnnotations,
        case_sensitive: caseSensitive,
      });

      const elapsed = Date.now() - startTime;
      if (elapsed < 700) {
        await new Promise((resolve) => setTimeout(resolve, 700 - elapsed));
      }

      if (res.success) {
        setResult(res);
      } else {
        setErrorMessage(res.message || '去除水印失败');
      }
    } catch (err: any) {
      const elapsed = Date.now() - startTime;
      if (elapsed < 500) {
        await new Promise((resolve) => setTimeout(resolve, 500 - elapsed));
      }
      setErrorMessage(typeof err === 'string' ? err : err?.message || '去除水印失败');
    } finally {
      setIsRemoving(false);
    }
  };

  return (
    <div className="flex-1 flex flex-col h-full bg-slate-50/50 dark:bg-slate-950 overflow-y-auto">
      <div className="titlebar-nodrag max-w-3xl w-full mx-auto p-6 space-y-6">
        {/* Header */}
        <div>
          <h2 className="text-lg font-bold text-slate-800 dark:text-slate-100 flex items-center space-x-2">
            <Sparkles className="w-5 h-5 text-amber-500" />
            <span>去除水印</span>
          </h2>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
            自动识别并清除 PDF 中的文字与图层水印
          </p>
        </div>

        {/* File Input Card */}
        <div className="bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800 rounded-2xl p-5 shadow-xs space-y-4">
          <div className="flex items-center justify-between">
            <label className="text-xs font-semibold text-slate-700 dark:text-slate-300">
              目标 PDF 文件
            </label>
            {inputPath && (
              <button
                onClick={handleAutoScan}
                disabled={isScanning}
                className="px-3 py-1 text-xs rounded-lg bg-amber-500/10 hover:bg-amber-500/20 text-amber-700 dark:text-amber-300 border border-amber-300/60 dark:border-amber-700 font-medium flex items-center space-x-1.5 transition-colors cursor-pointer"
              >
                <Search className={`w-3.5 h-3.5 ${isScanning ? 'animate-spin' : ''}`} />
                <span>{isScanning ? '正在扫描...' : '扫描水印'}</span>
              </button>
            )}
          </div>

          <div>
            <input
              type="text"
              value={inputPath}
              onChange={(e) => handleSelectFile(e.target.value)}
              placeholder="输入或粘贴 PDF 文件路径"
              className="w-full px-3 py-2 text-xs rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-800 dark:text-slate-200 focus:outline-hidden focus:ring-1 focus:ring-amber-500 font-mono"
            />
          </div>
        </div>

        {/* Scanning Loading State Feedback */}
        {isScanning && (
          <OperationStatusBanner
            status="loading"
            loadingLabel="正在扫描水印..."
            loadingSublabel="正在分析页面结构与图层"
            accentColor="amber"
            pixelVariant="Drive"
          />
        )}

        {/* Scan Results & Candidates Selection */}
        {analysis && (
          <div className="bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800 rounded-2xl p-5 shadow-xs space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center space-x-2">
                <ShieldCheck className="w-4 h-4 text-emerald-500" />
                <h3 className="text-xs font-bold text-slate-800 dark:text-slate-200">
                  检测结果（共 {analysis.total_pages} 页）
                </h3>
              </div>
              <span className="text-[11px] text-slate-400">点击选择要清除的项目</span>
            </div>

            {/* Detected Text Candidates */}
            <div>
              <div className="text-[11px] font-semibold text-slate-600 dark:text-slate-400 mb-2 flex items-center space-x-1">
                <Tag className="w-3.5 h-3.5" />
                <span>文字水印（{analysis.text_watermarks.length} 处）:</span>
              </div>

              {analysis.text_watermarks.length === 0 ? (
                <div className="p-3 rounded-xl bg-slate-50 dark:bg-slate-800/60 text-slate-400 text-xs text-center">
                  未检测到重复文字水印，可手动添加关键词
                </div>
              ) : (
                <div className="flex flex-wrap gap-2">
                  {analysis.text_watermarks.map((c) => {
                    const isSelected = targetTexts.includes(c.text);
                    return (
                      <button
                        key={c.text}
                        onClick={() => toggleCandidate(c)}
                        className={`px-2.5 py-1.5 rounded-xl border text-xs font-medium flex items-center space-x-2 transition-all cursor-pointer ${
                          isSelected
                            ? 'bg-amber-50 dark:bg-amber-950/40 border-amber-400 text-amber-700 dark:text-amber-300 ring-1 ring-amber-400/30'
                            : 'bg-slate-50 dark:bg-slate-800 border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-400 hover:border-slate-300'
                        }`}
                      >
                        <span className="font-semibold">{c.text}</span>
                        <span className="text-[10px] px-1.5 py-0.2 rounded-full bg-slate-200 dark:bg-slate-700 text-slate-600 dark:text-slate-300">
                          {c.page_count} 页 / {c.occurrences} 次
                        </span>
                        {isSelected && <Check className="w-3 h-3 text-amber-600" />}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Detected XObject Layers */}
            {analysis.xobject_watermarks.length > 0 && (
              <div className="pt-2 border-t border-slate-100 dark:border-slate-800">
                <div className="text-[11px] font-semibold text-slate-600 dark:text-slate-400 mb-2 flex items-center space-x-1">
                  <Layers className="w-3.5 h-3.5" />
                  <span>图层水印:</span>
                </div>
                <div className="flex flex-wrap gap-2">
                  {analysis.xobject_watermarks.map((xName) => {
                    const isSelected = targetXObjects.includes(xName);
                    return (
                      <button
                        key={xName}
                        onClick={() => toggleXObject(xName)}
                        className={`px-2.5 py-1 rounded-lg border text-xs font-mono transition-all cursor-pointer ${
                          isSelected
                            ? 'bg-amber-50 dark:bg-amber-950/40 border-amber-400 text-amber-700 dark:text-amber-300'
                            : 'bg-slate-50 dark:bg-slate-800 border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-400'
                        }`}
                      >
                        <span>{xName}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        )}

        {/* Custom Watermark Targets List */}
        <div className="bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800 rounded-2xl p-5 shadow-xs space-y-4">
          <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300">
            待清除水印
          </label>

          <div className="flex items-center space-x-2">
            <input
              type="text"
              value={newTextCustom}
              onChange={(e) => setNewTextCustom(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && addCustomText()}
              placeholder="输入水印文本，如“机密”、“草稿”"
              className="flex-1 px-3 py-2 text-xs rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-800 dark:text-slate-200 focus:outline-hidden focus:ring-1 focus:ring-amber-500"
            />
            <button
              onClick={addCustomText}
              className="px-3.5 py-2 text-xs rounded-xl bg-slate-800 hover:bg-slate-900 dark:bg-slate-700 text-white font-medium flex items-center space-x-1 cursor-pointer"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>添加</span>
            </button>
          </div>

          {/* Active Target Chips */}
          <div className="flex flex-wrap gap-2 min-h-10 p-2.5 rounded-xl border border-slate-100 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-950/50">
            {targetTexts.length === 0 ? (
              <span className="text-[11px] text-slate-400">
                暂无待清除项，请从上方选择或手动添加
              </span>
            ) : (
              targetTexts.map((text) => (
                <span
                  key={text}
                  className="px-2.5 py-1 rounded-lg bg-amber-500/10 text-amber-700 dark:text-amber-300 border border-amber-300/60 dark:border-amber-800 text-xs font-medium flex items-center space-x-1.5"
                >
                  <span>{text}</span>
                  <button
                    onClick={() => removeTargetText(text)}
                    className="hover:text-amber-900 dark:hover:text-amber-100"
                  >
                    <X className="w-3 h-3" />
                  </button>
                </span>
              ))
            )}
          </div>

          {/* Removal Options */}
          <div className="flex items-center space-x-5 pt-1 text-xs text-slate-600 dark:text-slate-300">
            <label className="flex items-center space-x-2 cursor-pointer">
              <input
                type="checkbox"
                checked={removeAnnotations}
                onChange={(e) => setRemoveAnnotations(e.target.checked)}
                className="rounded text-amber-600 focus:ring-amber-500"
              />
              <span>清除批注型水印</span>
            </label>

            <label className="flex items-center space-x-2 cursor-pointer">
              <input
                type="checkbox"
                checked={caseSensitive}
                onChange={(e) => setCaseSensitive(e.target.checked)}
                className="rounded text-amber-600 focus:ring-amber-500"
              />
              <span>区分大小写</span>
            </label>
          </div>
        </div>

        {/* Output Path */}
        <div className="bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800 rounded-2xl p-5 shadow-xs space-y-3">
          <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300">
            输出保存路径
          </label>
          <input
            type="text"
            value={outputPath}
            onChange={(e) => setOutputPath(e.target.value)}
            placeholder="/path/to/cleaned.pdf"
            className="w-full px-3 py-2 text-xs rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-800 dark:text-slate-200 focus:outline-hidden focus:ring-1 focus:ring-amber-500 font-mono"
          />
        </div>

        {/* Loading & Status feedback */}
        <OperationStatusBanner
          status={
            isRemoving ? 'loading' : errorMessage ? 'error' : result ? 'success' : 'idle'
          }
          loadingLabel="正在清除水印..."
          loadingSublabel="正在处理选中的文字与图层"
          accentColor="amber"
          pixelVariant="Drive"
          successTitle="水印清除完成"
          successMessage={result?.message || '文档已保存'}
          outputPath={result?.output_path}
          errorTitle="去水印失败"
          errorMessage={errorMessage}
          onRetry={handleRemoveWatermarks}
          onDismiss={() => {
            setErrorMessage(null);
            setResult(null);
          }}
        />

        {/* Action Button */}
        <button
          onClick={handleRemoveWatermarks}
          disabled={isRemoving || !inputPath.trim()}
          className="w-full py-3 px-4 rounded-xl bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-600 hover:to-orange-600 disabled:opacity-40 text-white font-medium text-xs shadow-md shadow-amber-500/20 flex items-center justify-center space-x-2 transition-all cursor-pointer disabled:cursor-not-allowed"
        >
          {isRemoving ? (
            <>
              <RefreshCw className="w-4 h-4 animate-spin" />
              <span>正在清除...</span>
            </>
          ) : (
            <>
              <Sparkles className="w-4 h-4" />
              <span>开始清除</span>
            </>
          )}
        </button>
      </div>
    </div>
  );
};
