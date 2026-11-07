"""
Pago anticipado: Caliente y Draftea pagan como ganada la apuesta a ganador (moneyline) si tu equipo
llega a ir arriba por cierta ventaja en cualquier momento, aunque después le empaten o le remonten.

Aquí se calcula la probabilidad de COBRAR con esa regla (más alta que la de ganar), para saber
qué momio mínimo basta cuando la casa tiene pago anticipado.
"""
import math

UMBRAL = {"soccer": 2, "basketball": 20, "americanfootball": 17, "baseball": 5}
SIGMA = {"basketball": 12.5, "americanfootball": 13.5, "baseball": 4.2}   # desviación típica del margen final


def _phi(x):
    return 0.5 * (1 + math.erf(x / math.sqrt(2)))


def _inv_phi(p):
    p = min(max(p, 1e-6), 1 - 1e-6)
    lo, hi = -8.0, 8.0
    for _ in range(80):
        m = (lo + hi) / 2
        if _phi(m) < p: lo = m
        else: hi = m
    return (lo + hi) / 2


def _poisson_res(lt, lo, n=12):
    pt = [math.exp(-lt) * lt ** k / math.factorial(k) for k in range(n)]
    po = [math.exp(-lo) * lo ** k / math.factorial(k) for k in range(n)]
    gana = sum(pt[i] * po[j] for i in range(n) for j in range(n) if i > j)
    emp = sum(pt[i] * po[i] for i in range(n))
    return gana, emp


def _lambdas(p_gana, p_emp):
    """Goles esperados (equipo, rival) que reproducen la prob. de ganar y de empatar (Poisson)."""
    mejor, err = (1.3, 1.1), 9
    for tot10 in range(14, 46):                     # 1.4 a 4.5 goles totales
        tot = tot10 / 10
        lo_, hi_ = 0.02, tot - 0.02
        for _ in range(40):                         # reparto que da la prob. de ganar
            lt = (lo_ + hi_) / 2
            g, _e = _poisson_res(lt, tot - lt)
            if g < p_gana: lo_ = lt
            else: hi_ = lt
        lt = (lo_ + hi_) / 2
        g, e = _poisson_res(lt, tot - lt)
        d = abs(e - p_emp) + abs(g - p_gana)
        if d < err:
            mejor, err = (lt, tot - lt), d
    return mejor


def _cobro_futbol(p_gana, p_emp, k=2, minutos=90):
    lt, lo = _lambdas(p_gana, max(p_emp or 0.26, 0.05))
    a, b = lt / minutos, lo / minutos
    # estado: diferencia de goles (no pagada); "pagado" es absorbente
    dist = {0: 1.0}
    pagado = 0.0
    for _ in range(minutos):
        nueva = {}
        for d, pr in dist.items():
            for dd, q in ((1, a), (-1, b), (0, 1 - a - b)):
                nd = d + dd
                if nd >= k:
                    pagado += pr * q
                else:
                    nueva[nd] = nueva.get(nd, 0) + pr * q
        dist = nueva
    return pagado + sum(pr for d, pr in dist.items() if d > 0)


def _cobro_continuo(p_gana, sigma, k):
    """Margen como movimiento browniano: prob. de tocar +k en algún momento o terminar arriba."""
    mu = sigma * _inv_phi(p_gana)
    s = sigma
    e = math.exp(min(50, 2 * mu * k / s ** 2))
    toca = _phi((mu - k) / s) + e * _phi((-k - mu) / s)
    # termina entre 0 y k sin haber tocado k
    entre = (_phi((k - mu) / s) - _phi(-mu / s)) - e * (_phi((-k - mu) / s) - _phi((-2 * k - mu) / s))
    return min(0.999, toca + max(0.0, entre))


def prob_cobro(tipo, p_gana, p_emp=None):
    """Probabilidad de cobrar una apuesta a ganador CON pago anticipado. tipo: soccer, basketball, ..."""
    if tipo not in UMBRAL or not p_gana:
        return None
    if tipo == "soccer":
        return _cobro_futbol(p_gana, p_emp)
    return _cobro_continuo(p_gana, SIGMA[tipo], UMBRAL[tipo])


def minima_anticipado(tipo, p_gana, minima, p_emp=None):
    """Momio mínimo (decimal) si la casa tiene pago anticipado, con la misma ventaja que pide el bot."""
    pc = prob_cobro(tipo, p_gana, p_emp)
    if not pc or pc <= p_gana:
        return None
    return round(minima * p_gana / pc, 3)


if __name__ == "__main__":
    for p, e in ((0.30, 0.27), (0.45, 0.27), (0.60, 0.23), (0.75, 0.16)):
        pc = prob_cobro("soccer", p, e)
        print(f"futbol gana {p:.0%} -> cobra {pc:.1%} (+{(pc - p) * 100:.1f} pts)")
    for t, p in (("basketball", 0.5), ("basketball", 0.75), ("americanfootball", 0.6), ("baseball", 0.55)):
        pc = prob_cobro(t, p)
        print(f"{t} gana {p:.0%} -> cobra {pc:.1%} (+{(pc - p) * 100:.1f} pts)")
