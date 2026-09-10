import type { RiskPreview } from '../domain/types';

export function EventOptionInfo({ preview, secondary = false }: { preview: RiskPreview; secondary?: boolean }) {
  if (secondary) return <div className="ap-option-info"><p>{preview.label || '必定成功'}</p>{preview.detail && <p>{preview.detail}</p>}</div>;
  const consequence = { '稳妥': '不会因本次事件受伤', '冒险': '有小概率受伤', '危险': '有大概率受伤', '极其危险': '有极大概率受伤' }[preview.label];
  return <div className="ap-option-info"><strong>{preview.label}</strong>{consequence && <p>{consequence}</p>}{preview.probabilities ? <dl>{(['extraSuccess', 'success', 'failure', 'bigFailure'] as const).map((key, i) => <div key={key}><dt>{['大成功', '成功', '失败', '大失败'][i]}</dt><dd>{Number((preview.probabilities![key] * 100).toFixed(1))}%</dd></div>)}</dl> : <p>{preview.detail}</p>}</div>;
}
