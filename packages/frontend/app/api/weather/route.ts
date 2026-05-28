import { NextRequest } from 'next/server';

type OpenMeteoGeocodingResponse = {
  results?: Array<{
    name: string;
    latitude: number;
    longitude: number;
    country?: string;
    country_code?: string;
    admin1?: string;
  }>;
};

type OpenMeteoForecastResponse = {
  daily: {
    time: string[];
    weather_code: number[];
    temperature_2m_max: number[];
    temperature_2m_min: number[];
  };
  current?: {
    temperature_2m: number;
    weather_code: number;
  };
};

const WEATHER_ICON_BY_CODE: Record<number, string> = {
  0:  '☀️',   // Clear sky
  1:  '🌤️',   // Mainly clear
  2:  '⛅',    // Partly cloudy
  3:  '☁️',   // Overcast
  45: '🌫️',   // Fog
  48: '🌫️',   // Icy fog
  51: '🌦️',   // Light drizzle
  53: '🌦️',   // Moderate drizzle
  55: '🌧️',   // Dense drizzle
  56: '🌧️',   // Light freezing drizzle
  57: '🌧️',   // Dense freezing drizzle
  61: '🌧️',   // Slight rain
  63: '🌧️',   // Moderate rain
  65: '🌧️',   // Heavy rain
  66: '🌧️',   // Light freezing rain
  67: '🌧️',   // Heavy freezing rain
  71: '🌨️',   // Slight snow
  73: '🌨️',   // Moderate snow
  75: '❄️',   // Heavy snow
  77: '🌨️',   // Snow grains
  80: '🌦️',   // Slight showers
  81: '🌧️',   // Moderate showers
  82: '⛈️',   // Violent showers
  85: '🌨️',   // Slight snow showers
  86: '❄️',   // Heavy snow showers
  95: '⛈️',   // Thunderstorm
  96: '⛈️',   // Thunderstorm + slight hail
  99: '⛈️',   // Thunderstorm + heavy hail
};

function iconForCode(code: number): string {
  return WEATHER_ICON_BY_CODE[code] ?? '⛅';
}

function normalize(value: string): string {
  return value.trim().toLowerCase();
}

function buildLocationVariants(location: string, country?: string): string[] {
  const variants = new Set<string>([location.trim()]);
  const normalizedCountry = normalize(country ?? '');
  if (!normalizedCountry.includes('denmark') && !normalizedCountry.includes('dk')) {
    return Array.from(variants).filter((value) => value.length > 0);
  }

  const danishFallbacks: Array<[RegExp, string]> = [
    [/aa/gi, 'å'],
    [/ae/gi, 'æ'],
    [/oe/gi, 'ø'],
    [/or/gi, 'ør'],
    [/ar/gi, 'år'],
  ];

  for (const [pattern, replacement] of danishFallbacks) {
    if (pattern.test(location)) {
      variants.add(location.replace(pattern, replacement));
    }
  }

  return Array.from(variants).filter((value) => value.length > 0);
}

async function geocodeLocationVariants(location: string, country?: string): Promise<OpenMeteoGeocodingResponse['results']> {
  const variants = buildLocationVariants(location, country);
  for (const variant of variants) {
    const geocodeParams = new URLSearchParams({
      name: variant,
      count: '10',
      language: 'en',
      format: 'json',
    });

    const geocodeResponse = await fetch(`https://geocoding-api.open-meteo.com/v1/search?${geocodeParams.toString()}`, {
      cache: 'no-store',
    });

    if (!geocodeResponse.ok) {
      continue;
    }

    const geocodePayload = (await geocodeResponse.json()) as OpenMeteoGeocodingResponse;
    if ((geocodePayload.results?.length ?? 0) > 0) {
      return geocodePayload.results;
    }
  }

  return [];
}

function includeCandidate(
  candidate: { country?: string; country_code?: string; admin1?: string },
  state?: string,
  country?: string,
): boolean {
  const stateNormalized = state ? normalize(state) : '';
  const countryNormalized = country ? normalize(country) : '';

  const stateMatches = !stateNormalized || normalize(candidate.admin1 ?? '').includes(stateNormalized);
  const countryMatches = !countryNormalized
    || normalize(candidate.country ?? '').includes(countryNormalized)
    || normalize(candidate.country_code ?? '').includes(countryNormalized);

  return stateMatches && countryMatches;
}

export async function GET(request: NextRequest): Promise<Response> {
  const url = new URL(request.url);
  const location = (url.searchParams.get('location') ?? '').trim();
  const state = (url.searchParams.get('state') ?? '').trim();
  const country = (url.searchParams.get('country') ?? '').trim();
  const daysRaw = Number(url.searchParams.get('days') ?? '7');
  const unit = (url.searchParams.get('unit') ?? 'C').toUpperCase() === 'F' ? 'F' : 'C';
  const days = Number.isFinite(daysRaw) ? Math.max(1, Math.min(14, Math.floor(daysRaw))) : 7;

  if (!location) {
    return Response.json({ message: 'location is required' }, { status: 400 });
  }

  const candidates = (await geocodeLocationVariants(location, country)) ?? [];
  const resolved = candidates.find((candidate) => includeCandidate(candidate, state, country)) ?? candidates[0];

  if (!resolved) {
    return Response.json({ message: 'Location not found' }, { status: 404 });
  }

  const forecastParams = new URLSearchParams({
    latitude: String(resolved.latitude),
    longitude: String(resolved.longitude),
    daily: 'weather_code,temperature_2m_max,temperature_2m_min',
    current: 'temperature_2m,weather_code',
    forecast_days: String(days),
    timezone: 'auto',
    temperature_unit: unit === 'F' ? 'fahrenheit' : 'celsius',
  });

  const forecastResponse = await fetch(`https://api.open-meteo.com/v1/forecast?${forecastParams.toString()}`, {
    cache: 'no-store',
  });

  if (!forecastResponse.ok) {
    return Response.json({ message: 'Could not fetch weather forecast' }, { status: 503 });
  }

  const forecastPayload = (await forecastResponse.json()) as OpenMeteoForecastResponse;
  const daily = forecastPayload.daily.time.map((date, index) => ({
    date,
    weatherCode: forecastPayload.daily.weather_code[index] ?? 0,
    icon: iconForCode(forecastPayload.daily.weather_code[index] ?? 0),
    tempMax: forecastPayload.daily.temperature_2m_max[index] ?? 0,
    tempMin: forecastPayload.daily.temperature_2m_min[index] ?? 0,
  }));

  return Response.json({
    resolvedLocation: {
      name: resolved.name,
      admin1: resolved.admin1,
      country: resolved.country,
      latitude: resolved.latitude,
      longitude: resolved.longitude,
    },
    unit,
    current: {
      temperature: forecastPayload.current?.temperature_2m ?? daily[0]?.tempMax ?? 0,
      weatherCode: forecastPayload.current?.weather_code ?? daily[0]?.weatherCode ?? 0,
      icon: iconForCode(forecastPayload.current?.weather_code ?? daily[0]?.weatherCode ?? 0),
    },
    daily,
  });
}
