/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState, useMemo, useCallback, ChangeEvent, ReactNode } from 'react';
import { 
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, 
  AreaChart, Area, PieChart, Pie, Cell, Legend
} from 'recharts';
import { 
  TrendingUp, TrendingDown, Calendar, Upload, BarChart3, 
  History, DollarSign, Percent, Filter, RefreshCcw, Search
} from 'lucide-react';
import { format, isWithinInterval, parseISO, startOfDay, endOfDay } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { motion, AnimatePresence } from 'motion/react';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

// --- Utility ---
function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

// --- Types ---
interface Trade {
  marketName: string;
  tokenName: string;
  invested: number;
  returned: number;
  pnl: number;
  result: 'WIN' | 'LOSS' | 'EVEN';
  timestamp: number;
  dateStr: string;
}

interface DailyStats {
  date: string;
  pnl: number;
  trades: number;
}

export default function App() {
  const [trades, setTrades] = useState<Trade[]>([]);
  const [startDate, setStartDate] = useState<string>('');
  const [endDate, setEndDate] = useState<string>('');
  const [isDragging, setIsDragging] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');

  // --- CSV Processing ---
  const processCSV = useCallback((text: string) => {
    const lines = text.trim().split('\n');
    if (lines.length < 2) return;

    const headers = lines[0].replace(/^\uFEFF/, '').split(',').map(h => h.replace(/"/g, '').trim());
    const rows = lines.slice(1).map(line => {
      const cols: string[] = [];
      let cur = "", inQ = false;
      for (const ch of line) {
        if (ch === '"') { inQ = !inQ; continue; }
        if (ch === "," && !inQ) { cols.push(cur.trim()); cur = ""; }
        else cur += ch;
      }
      cols.push(cur.trim());
      return Object.fromEntries(headers.map((h, i) => [h, cols[i] ?? ""]));
    });

    const markets: Record<string, { buys: any[], redeems: any[], sells: any[] }> = {};

    rows.forEach(r => {
      if (!['Buy', 'Redeem', 'Sell'].includes(r.action)) return;
      if (!markets[r.marketName]) markets[r.marketName] = { buys: [], redeems: [], sells: [] };
      if (r.action === 'Buy') markets[r.marketName].buys.push(r);
      if (r.action === 'Redeem') markets[r.marketName].redeems.push(r);
      if (r.action === 'Sell') markets[r.marketName].sells.push(r);
    });

    const processedTrades: Trade[] = [];

    Object.entries(markets).forEach(([name, data]) => {
      if (!data.buys.length) return;

      const invested = data.buys.reduce((s, b) => s + Number(b.usdcAmount), 0);
      const redeem = data.redeems.reduce((s, r) => s + Number(r.usdcAmount), 0);
      const sell = data.sells.reduce((s, r) => s + Number(r.usdcAmount), 0);
      const returned = redeem + sell;
      const pnl = Math.round((returned - invested) * 100) / 100;
      
      // Consideramos WIN/LOSS com uma margem pequena para ignorar taxas/arredondamentos irrelevantes
      const result = pnl > 0.001 ? 'WIN' : pnl < -0.001 ? 'LOSS' : 'EVEN';
      const tokenName = data.buys[0].tokenName || '—';
      
      // Usar o timestamp da última ação (fechamento) para o filtro de data ser mais preciso no PnL
      const allActions = [...data.buys, ...data.redeems, ...data.sells];
      const ts = Math.max(...allActions.map(a => Number(a.timestamp)));

      processedTrades.push({
        marketName: name,
        tokenName,
        invested,
        returned,
        pnl,
        result,
        timestamp: ts,
        dateStr: format(new Date(ts * 1000), 'yyyy-MM-dd')
      });
    });

    processedTrades.sort((a, b) => a.timestamp - b.timestamp);
    setTrades(processedTrades);
    
    if (processedTrades.length > 0) {
      setStartDate(processedTrades[0].dateStr);
      setEndDate(processedTrades[processedTrades.length - 1].dateStr);
    }
  }, []);

  const handleFileUpload = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = (ev) => processCSV(ev.target?.result as string);
      reader.readAsText(file);
    }
  };

  const loadDemoData = () => {
    const demo: Trade[] = [];
    const now = Date.now() / 1000;
    for (let i = 0; i < 60; i++) {
      const ts = now - (60 - i) * 86400;
      const pnl = Math.random() > 0.4 ? Math.random() * 150 : -Math.random() * 100;
      demo.push({
        marketName: `Mercado Demo ${i + 1}`,
        tokenName: Math.random() > 0.5 ? 'Yes' : 'No',
        invested: 100,
        returned: 100 + pnl,
        pnl: Math.round(pnl * 100) / 100,
        result: pnl > 0.001 ? 'WIN' : pnl < -0.001 ? 'LOSS' : 'EVEN',
        timestamp: ts,
        dateStr: format(new Date(ts * 1000), 'yyyy-MM-dd')
      });
    }
    setTrades(demo);
    setStartDate(demo[0].dateStr);
    setEndDate(demo[demo.length - 1].dateStr);
  };

  // --- Filtering ---
  const filteredTrades = useMemo(() => {
    return trades.filter(t => {
      const date = parseISO(t.dateStr);
      const start = startDate ? startOfDay(parseISO(startDate)) : null;
      const end = endDate ? endOfDay(parseISO(endDate)) : null;
      
      const matchesDate = (!start || date >= start) && (!end || date <= end);
      const matchesSearch = t.marketName.toLowerCase().includes(searchTerm.toLowerCase());
      
      return matchesDate && matchesSearch;
    });
  }, [trades, startDate, endDate, searchTerm]);

  // --- Stats ---
  const stats = useMemo(() => {
    const total = filteredTrades.length;
    // Contando EVEN como WIN conforme solicitado
    const wins = filteredTrades.filter(t => t.result === 'WIN' || t.result === 'EVEN').length;
    const losses = filteredTrades.filter(t => t.result === 'LOSS').length;
    
    // Winrate baseado em trades decididos (agora incluindo EVEN como WIN)
    const decidedTrades = wins + losses;
    const winrate = decidedTrades > 0 ? (wins / decidedTrades * 100).toFixed(1) : '0';
    
    const totalInvested = filteredTrades.reduce((s, t) => s + t.invested, 0);
    const totalReturned = filteredTrades.reduce((s, t) => s + t.returned, 0);
    const totalPnl = totalReturned - totalInvested;
    const avgPnl = total > 0 ? (totalPnl / total).toFixed(2) : '0';

    return { total, wins, losses, winrate, totalInvested, totalReturned, totalPnl, avgPnl };
  }, [filteredTrades]);

  const equityData = useMemo(() => {
    let cumulative = 0;
    return filteredTrades.map(t => {
      cumulative += t.pnl;
      return {
        date: format(new Date(t.timestamp * 1000), 'dd/MM', { locale: ptBR }),
        pnl: Math.round(cumulative * 100) / 100,
        tradePnl: t.pnl,
        market: t.marketName
      };
    });
  }, [filteredTrades]);

  const pieData = [
    { name: 'Wins', value: stats.wins, color: '#10b981' },
    { name: 'Losses', value: stats.losses, color: '#ef4444' }
  ];

  return (
    <div className="min-h-screen bg-[#09090b] text-zinc-100 p-4 md:p-8 font-sans">
      {/* Header */}
      <header className="max-w-7xl mx-auto flex flex-col md:flex-row justify-between items-start md:items-center gap-4 mb-8">
        <div>
          <h1 className="text-3xl font-bold tracking-tight flex items-center gap-2">
            <BarChart3 className="text-blue-500 w-8 h-8" />
            Polymarket Pro
          </h1>
          <p className="text-zinc-500 text-sm mt-1">Análise avançada de performance e histórico</p>
        </div>
        
        <div className="flex flex-wrap gap-3">
          <button 
            onClick={loadDemoData}
            className="px-4 py-2 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 rounded-lg text-sm font-medium transition-colors flex items-center gap-2"
          >
            <RefreshCcw className="w-4 h-4" /> Dados Demo
          </button>
          <label className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-lg text-sm font-medium transition-colors cursor-pointer flex items-center gap-2">
            <Upload className="w-4 h-4" /> Carregar CSV
            <input type="file" accept=".csv" onChange={handleFileUpload} className="hidden" />
          </label>
        </div>
      </header>

      {trades.length === 0 ? (
        <motion.div 
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className={cn(
            "max-w-3xl mx-auto mt-20 border-2 border-dashed rounded-2xl p-12 text-center transition-colors",
            isDragging ? "border-blue-500 bg-blue-500/5" : "border-zinc-800 bg-zinc-900/50"
          )}
          onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
          onDragLeave={() => setIsDragging(false)}
          onDrop={(e) => {
            e.preventDefault();
            setIsDragging(false);
            const file = e.dataTransfer.files[0];
            if (file) {
              const reader = new FileReader();
              reader.onload = (ev) => processCSV(ev.target?.result as string);
              reader.readAsText(file);
            }
          }}
        >
          <div className="bg-zinc-800 w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-6">
            <Upload className="w-8 h-8 text-zinc-400" />
          </div>
          <h2 className="text-xl font-semibold mb-2">Comece carregando seu histórico</h2>
          <p className="text-zinc-500 mb-8 max-w-md mx-auto">
            Arraste o arquivo CSV exportado do Polymarket ou clique no botão acima para analisar seus lucros e perdas.
          </p>
          <div className="flex justify-center gap-4">
            <div className="text-xs text-zinc-600 bg-zinc-800/50 px-3 py-1 rounded-full">Buy</div>
            <div className="text-xs text-zinc-600 bg-zinc-800/50 px-3 py-1 rounded-full">Redeem</div>
            <div className="text-xs text-zinc-600 bg-zinc-800/50 px-3 py-1 rounded-full">Sell</div>
          </div>
        </motion.div>
      ) : (
        <div className="max-w-7xl mx-auto space-y-6">
          
          {/* Filters Bar */}
          <motion.div 
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            className="bg-zinc-900/50 border border-zinc-800 p-4 rounded-xl flex flex-wrap items-center gap-6"
          >
            <div className="flex items-center gap-3">
              <Filter className="w-4 h-4 text-zinc-500" />
              <span className="text-sm font-medium text-zinc-400">Filtros:</span>
            </div>

            <div className="flex items-center gap-2">
              <Calendar className="w-4 h-4 text-zinc-500" />
              <input 
                type="date" 
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                className="bg-zinc-800 border-none rounded-md px-3 py-1.5 text-sm focus:ring-2 focus:ring-blue-500 outline-none"
              />
              <span className="text-zinc-600">até</span>
              <input 
                type="date" 
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                className="bg-zinc-800 border-none rounded-md px-3 py-1.5 text-sm focus:ring-2 focus:ring-blue-500 outline-none"
              />
            </div>

            <div className="flex-1 min-w-[200px] relative">
              <Search className="w-4 h-4 text-zinc-500 absolute left-3 top-1/2 -translate-y-1/2" />
              <input 
                type="text" 
                placeholder="Buscar mercado..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="w-full bg-zinc-800 border-none rounded-md pl-10 pr-4 py-1.5 text-sm focus:ring-2 focus:ring-blue-500 outline-none"
              />
            </div>

            <div className="text-xs text-zinc-500">
              Mostrando {filteredTrades.length} de {trades.length} apostas
            </div>
          </motion.div>

          {/* Stats Grid */}
          <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-4 gap-4">
            <StatCard 
              label="Lucro Total" 
              value={`$${stats.totalPnl.toFixed(2)}`} 
              icon={<DollarSign className="w-4 h-4" />}
              trend={stats.totalPnl >= 0 ? 'up' : 'down'}
            />
            <StatCard 
              label="Win Rate" 
              value={`${stats.winrate}%`} 
              icon={<Percent className="w-4 h-4" />}
              subValue={`${stats.wins}W / ${stats.losses}L`}
            />
            <StatCard 
              label="Total Apostado" 
              value={`$${stats.totalInvested.toLocaleString()}`} 
              icon={<TrendingUp className="w-4 h-4 text-blue-400" />}
            />
            <StatCard 
              label="Média por Aposta" 
              value={`$${stats.avgPnl}`} 
              icon={<RefreshCcw className="w-4 h-4" />}
              trend={Number(stats.avgPnl) >= 0 ? 'up' : 'down'}
            />
          </div>

          {/* Charts Row */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <div className="lg:col-span-2 bg-zinc-900/50 border border-zinc-800 p-6 rounded-2xl">
              <div className="flex justify-between items-center mb-6">
                <h3 className="font-semibold flex items-center gap-2">
                  <TrendingUp className="w-5 h-5 text-blue-500" /> Curva de Patrimônio
                </h3>
                <div className="text-xs text-zinc-500">PnL Acumulado ($)</div>
              </div>
              <div className="h-[300px] w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={equityData}>
                    <defs>
                      <linearGradient id="colorPnl" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.3}/>
                        <stop offset="95%" stopColor="#3b82f6" stopOpacity={0}/>
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="#27272a" vertical={false} />
                    <XAxis 
                      dataKey="date" 
                      stroke="#71717a" 
                      fontSize={12} 
                      tickLine={false} 
                      axisLine={false} 
                    />
                    <YAxis 
                      stroke="#71717a" 
                      fontSize={12} 
                      tickLine={false} 
                      axisLine={false} 
                      tickFormatter={(v) => `$${v}`}
                    />
                    <Tooltip 
                      contentStyle={{ backgroundColor: '#18181b', border: '1px solid #3f3f46', borderRadius: '8px' }}
                      itemStyle={{ color: '#3b82f6' }}
                    />
                    <Area 
                      type="monotone" 
                      dataKey="pnl" 
                      stroke="#3b82f6" 
                      strokeWidth={2}
                      fillOpacity={1} 
                      fill="url(#colorPnl)" 
                    />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </div>

            <div className="bg-zinc-900/50 border border-zinc-800 p-6 rounded-2xl flex flex-col">
              <h3 className="font-semibold mb-6 flex items-center gap-2">
                <History className="w-5 h-5 text-purple-500" /> Distribuição
              </h3>
              <div className="flex-1 h-[200px]">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={pieData}
                      cx="50%"
                      cy="50%"
                      innerRadius={60}
                      outerRadius={80}
                      paddingAngle={5}
                      dataKey="value"
                    >
                      {pieData.map((entry, index) => (
                        <Cell key={`cell-${index}`} fill={entry.color} />
                      ))}
                    </Pie>
                    <Tooltip 
                      contentStyle={{ backgroundColor: '#18181b', border: '1px solid #3f3f46', borderRadius: '8px' }}
                    />
                    <Legend verticalAlign="bottom" height={36}/>
                  </PieChart>
                </ResponsiveContainer>
              </div>
              <div className="mt-4 space-y-2">
                <div className="flex justify-between text-sm">
                  <span className="text-zinc-500">Total de Apostas</span>
                  <span className="font-medium">{stats.total}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-zinc-500">Taxa de Sucesso</span>
                  <span className="font-medium text-emerald-500">{stats.winrate}%</span>
                </div>
              </div>
            </div>
          </div>

          {/* History Table */}
          <div className="bg-zinc-900/50 border border-zinc-800 rounded-2xl overflow-hidden">
            <div className="p-6 border-b border-zinc-800 flex justify-between items-center">
              <h3 className="font-semibold flex items-center gap-2">
                <History className="w-5 h-5 text-zinc-400" /> Histórico Detalhado
              </h3>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="bg-zinc-800/30 text-zinc-400">
                    <th className="px-6 py-4 font-medium">Data</th>
                    <th className="px-6 py-4 font-medium">Mercado</th>
                    <th className="px-6 py-4 font-medium">Lado</th>
                    <th className="px-6 py-4 font-medium">Investido</th>
                    <th className="px-6 py-4 font-medium text-right">PnL</th>
                    <th className="px-6 py-4 font-medium text-center">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-800">
                  <AnimatePresence mode="popLayout">
                    {filteredTrades.slice().reverse().map((trade, idx) => (
                      <motion.tr 
                        layout
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        key={trade.marketName + trade.timestamp} 
                        className="hover:bg-zinc-800/20 transition-colors"
                      >
                        <td className="px-6 py-4 text-zinc-500">
                          {format(new Date(trade.timestamp * 1000), 'dd MMM yyyy', { locale: ptBR })}
                        </td>
                        <td className="px-6 py-4 font-medium max-w-xs truncate" title={trade.marketName}>
                          {trade.marketName}
                        </td>
                        <td className="px-6 py-4">
                          <span className={cn(
                            "px-2 py-0.5 rounded text-[10px] uppercase font-bold",
                            trade.tokenName === 'Yes' ? "bg-emerald-500/10 text-emerald-500" : "bg-rose-500/10 text-rose-500"
                          )}>
                            {trade.tokenName}
                          </span>
                        </td>
                        <td className="px-6 py-4 text-zinc-400">
                          ${trade.invested.toFixed(2)}
                        </td>
                        <td className={cn(
                          "px-6 py-4 font-bold text-right",
                          trade.pnl > 0 ? "text-emerald-500" : trade.pnl < 0 ? "text-rose-500" : "text-zinc-500"
                        )}>
                          {trade.pnl > 0 ? '+' : ''}${trade.pnl.toFixed(2)}
                        </td>
                        <td className="px-6 py-4 text-center">
                          <span className={cn(
                            "px-2 py-1 rounded-full text-[10px] font-bold",
                            trade.result === 'WIN' ? "bg-emerald-500/20 text-emerald-500" : 
                            trade.result === 'LOSS' ? "bg-rose-500/20 text-rose-500" : "bg-zinc-700 text-zinc-400"
                          )}>
                            {trade.result}
                          </span>
                        </td>
                      </motion.tr>
                    ))}
                  </AnimatePresence>
                </tbody>
              </table>
              {filteredTrades.length === 0 && (
                <div className="p-12 text-center text-zinc-600">
                  Nenhuma aposta encontrada para este filtro.
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function StatCard({ label, value, icon, trend, subValue }: { 
  label: string; 
  value: string; 
  icon: ReactNode; 
  trend?: 'up' | 'down';
  subValue?: string;
}) {
  return (
    <div className="bg-zinc-900/50 border border-zinc-800 p-5 rounded-2xl hover:border-zinc-700 transition-colors">
      <div className="flex justify-between items-start mb-3">
        <div className="p-2 bg-zinc-800 rounded-lg text-zinc-400">
          {icon}
        </div>
        {trend && (
          <div className={cn(
            "flex items-center gap-0.5 text-xs font-bold",
            trend === 'up' ? "text-emerald-500" : "text-rose-500"
          )}>
            {trend === 'up' ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
          </div>
        )}
      </div>
      <div>
        <p className="text-zinc-500 text-xs font-medium uppercase tracking-wider mb-1">{label}</p>
        <h4 className="text-2xl font-bold tracking-tight">{value}</h4>
        {subValue && <p className="text-zinc-600 text-[10px] mt-1 font-medium">{subValue}</p>}
      </div>
    </div>
  );
}
