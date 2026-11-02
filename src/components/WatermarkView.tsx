import React, { useState, useEffect } from 'react';
import {
  Sparkles,
  Search,
  CheckCircle2,
  AlertTriangle,
  RefreshCw,
  ExternalLink,
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

    try {
      const res = await api.removeWatermarks({
        input_path: inputPath.trim(),
        output_path: outputPath.trim(),
        target_texts: targetTexts,
        target_xobjects: targetXObjects,
        remove_annotations: removeAnnotations,
        case_sensitive: caseSensitive,
      });
      setResult(res);
    } catch (err: any) {
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
            <span>PDF 水印智能去除</span>
          </h2>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
            深度分析 PDF 内容流 (Content Stream) 与 Form XObject 透明图层，精准定位并清除重复水印文本与叠层
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
                <span>{isScanning ? '正在扫描流与图层...' : '智能扫描水印特征'}</span>
              </button>
            )}
          </div>

          <div>
            <input
              type="text"
              value={inputPath}
              onChange={(e) => handleSelectFile(e.target.value)}
              placeholder="输入或粘贴文件绝对路径，例如 /Users/jzefan/sample.pdf"
              className="w-full px-3 py-2 text-xs rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-800 dark:text-slate-200 focus:outline-hidden focus:ring-1 focus:ring-amber-500 font-mono"
            />
          </div>
        </div>

        {/* Scan Results & Candidates Selection */}
        {analysis && (
          <div className="bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800 rounded-2xl p-5 shadow-xs space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center space-x-2">
                <ShieldCheck className="w-4 h-4 text-emerald-500" />
                <h3 className="text-xs font-bold text-slate-800 dark:text-slate-200">
                  扫描完成（共检测 {analysis.total_pages} 页）
                </h3>
              </div>
              <span className="text-[11px] text-slate-400">点击关键词即可勾选/取消</span>
            </div>

            {/* Detected Text Candidates */}
            <div>
              <div className="text-[11px] font-semibold text-slate-600 dark:text-slate-400 mb-2 flex items-center space-x-1">
                <Tag className="w-3.5 h-3.5" />
                <span>自动检测到的文字水印特征 ({analysis.text_watermarks.length} 处):</span>
              </div>

              {analysis.text_watermarks.length === 0 ? (
                <div className="p-3 rounded-xl bg-slate-50 dark:bg-slate-800/60 text-slate-400 text-xs text-center">
                  未检测到跨页重复文字水印，您可在下方手动添加指定文字
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
                  <span>检测到的透明 Form XObject 图层:</span>
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
            清除清单与自定义水印文本
          </label>

          <div className="flex items-center space-x-2">
            <input
              type="text"
              value={newTextCustom}
              onChange={(e) => setNewTextCustom(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && addCustomText()}
              placeholder="输入需要清除的自定义水印文本，如：机密、草稿、公司名称"
              className="flex-1 px-3 py-2 text-xs rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-800 dark:text-slate-200 focus:outline-hidden focus:ring-1 focus:ring-amber-500"
            />
            <button
              onClick={addCustomText}
              className="px-3.5 py-2 text-xs rounded-xl bg-slate-800 hover:bg-slate-900 dark:bg-slate-700 text-white font-medium flex items-center space-x-1 cursor-pointer"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>添加关键词</span>
            </button>
          </div>

          {/* Active Target Chips */}
          <div className="flex flex-wrap gap-2 min-h-10 p-2.5 rounded-xl border border-slate-100 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-950/50">
            {targetTexts.length === 0 ? (
              <span className="text-[11px] text-slate-400">
                暂无待清除的目标。点击上方扫描出的关键词或在此手动添加
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
              <span>自动清除 PDF 批注水印 (Annotation)</span>
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
            去水印后输出路径
          </label>
          <input
            type="text"
            value={outputPath}
            onChange={(e) => setOutputPath(e.target.value)}
            placeholder="/path/to/cleaned.pdf"
            className="w-full px-3 py-2 text-xs rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-800 dark:text-slate-200 focus:outline-hidden focus:ring-1 focus:ring-amber-500 font-mono"
          />
        </div>

        {/* Error notification */}
        {errorMessage && (
          <div className="p-3 rounded-xl bg-rose-50 dark:bg-rose-950/50 border border-rose-200 dark:border-rose-800 text-rose-600 dark:text-rose-400 text-xs flex items-center space-x-2">
            <AlertTriangle className="w-4 h-4 shrink-0" />
            <span>{errorMessage}</span>
          </div>
        )}

        {/* Success Result */}
        {result && (
          <div className="bg-gradient-to-br from-amber-500/10 to-orange-500/10 border border-amber-500/30 rounded-2xl p-5 space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center space-x-2 text-amber-700 dark:text-amber-300 font-semibold text-sm">
                <CheckCircle2 className="w-5 h-5 text-amber-500" />
                <span>处理完成！</span>
              </div>
              {result.output_path && (
                <button
                  onClick={() => api.revealInFinder(result.output_path!)}
                  className="px-3 py-1 rounded-lg bg-amber-600 hover:bg-amber-700 text-white font-medium text-xs flex items-center space-x-1.5 shadow-2xs"
                >
                  <span>在访达中显示</span>
                  <ExternalLink className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
            <p className="text-xs text-slate-600 dark:text-slate-300 leading-relaxed">
              {result.message}
            </p>
          </div>
        )}

        {/* Action Button */}
        <button
          onClick={handleRemoveWatermarks}
          disabled={isRemoving || !inputPath.trim()}
          className="w-full py-3 px-4 rounded-xl bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-600 hover:to-orange-600 disabled:opacity-40 text-white font-medium text-xs shadow-md shadow-amber-500/20 flex items-center justify-center space-x-2 transition-all cursor-pointer disabled:cursor-not-allowed"
        >
          {isRemoving ? (
            <>
              <RefreshCw className="w-4 h-4 animate-spin" />
              <span>正在重构内容流并清除水印...</span>
            </>
          ) : (
            <>
              <Sparkles className="w-4 h-4" />
              <span>立即执行水印清除</span>
            </>
          )}
        </button>
      </div>
    </div>
  );
};
