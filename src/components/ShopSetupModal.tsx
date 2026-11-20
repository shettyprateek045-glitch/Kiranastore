import React, { useState } from 'react';
import { MapPin, Store } from 'lucide-react';
import { useShop } from '../context/ShopContext.tsx';

export function ShopSetupModal() {
  const { user, createNewShop, signOutUser, enterDemoMode } = useShop();
  const [name, setName] = useState('');
  const [ownerName, setOwnerName] = useState(user?.displayName || '');
  const [phone, setPhone] = useState('');
  const [city, setCity] = useState('Mysuru');
  const [stateName, setStateName] = useState('Karnataka');
  const [pincode, setPincode] = useState('');
  const [address, setAddress] = useState('');
  const [coords, setCoords] = useState<{ lat: number; lng: number } | null>(null);
  const [locStatus, setLocStatus] = useState('');
  const [seedSample, setSeedSample] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  const handleLocateMe = () => {
    if (!navigator.geolocation) {
      setLocStatus('Browser location is unavailable. Please enter your city manually.');
      return;
    }
    setLocStatus('Requesting location permission...');
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setCoords({
          lat: Number(pos.coords.latitude.toFixed(4)),
          lng: Number(pos.coords.longitude.toFixed(4)),
        });
        setLocStatus(
          `Coordinates captured (${pos.coords.latitude.toFixed(3)}, ${pos.coords.longitude.toFixed(3)}).`
        );
      },
      () => {
        setLocStatus('Location permission declined — manual city entry works normally.');
      }
    );
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (!name.trim()) {
      setError('Please enter your shop name.');
      return;
    }
    setSubmitting(true);
    try {
      await createNewShop({
        name: name.trim(),
        ownerName: ownerName.trim() || user?.displayName || 'Shop Owner',
        phone: phone.trim(),
        city: city.trim() || 'Mysuru',
        state: stateName.trim() || 'Karnataka',
        pincode: pincode.trim(),
        address: address.trim(),
        latitude: coords?.lat ?? null,
        longitude: coords?.lng ?? null,
        seedSample,
      });
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Could not create shop profile.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#F8FAF8] flex items-center justify-center p-6">
      <div className="w-full max-w-2xl bg-white border border-[#DCE6DF] rounded-2xl p-8">
        <div className="flex items-start justify-between gap-4 pb-6 border-b border-[#EDF2EE]">
          <div>
            <p className="text-xs font-medium text-[#15803D]">Step 1 of 1 · Shop Onboarding</p>
            <h1 className="mt-1 font-display text-2xl font-bold text-[#0D2818]">
              Set up your Kirana shop profile
            </h1>
            <p className="mt-1 text-sm text-[#4D6154]">
              Signed in as {user?.email}. Your inventory, sales, and forecasts are isolated privately to your shop.
            </p>
          </div>
          <Store className="w-7 h-7 text-[#15803D] shrink-0" />
        </div>

        <form onSubmit={handleSubmit} className="mt-6 space-y-4">
          {error && (
            <div className="p-3 rounded-lg bg-red-50 border border-red-200 text-sm text-red-700">
              {error}
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-[#3F5346] mb-1.5">
                Shop Name *
              </label>
              <input
                type="text"
                required
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g., Ganesh Provision & Kirana Store"
                className="w-full px-3.5 py-2.5 text-sm border border-[#C6D5CA] rounded-lg focus:outline-none focus:ring-2 focus:ring-[#15803D]/30 focus:border-[#15803D]"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-[#3F5346] mb-1.5">
                Owner Name *
              </label>
              <input
                type="text"
                required
                value={ownerName}
                onChange={(e) => setOwnerName(e.target.value)}
                placeholder="e.g., Ramesh Shetty"
                className="w-full px-3.5 py-2.5 text-sm border border-[#C6D5CA] rounded-lg focus:outline-none focus:ring-2 focus:ring-[#15803D]/30 focus:border-[#15803D]"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div>
              <label className="block text-xs font-medium text-[#3F5346] mb-1.5">City / Town *</label>
              <input
                type="text"
                required
                value={city}
                onChange={(e) => setCity(e.target.value)}
                className="w-full px-3.5 py-2.5 text-sm border border-[#C6D5CA] rounded-lg focus:outline-none focus:ring-2 focus:ring-[#15803D]/30 focus:border-[#15803D]"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-[#3F5346] mb-1.5">State *</label>
              <input
                type="text"
                required
                value={stateName}
                onChange={(e) => setStateName(e.target.value)}
                className="w-full px-3.5 py-2.5 text-sm border border-[#C6D5CA] rounded-lg focus:outline-none focus:ring-2 focus:ring-[#15803D]/30 focus:border-[#15803D]"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-[#3F5346] mb-1.5">PIN Code</label>
              <input
                type="text"
                value={pincode}
                onChange={(e) => setPincode(e.target.value)}
                placeholder="570001"
                className="w-full px-3.5 py-2.5 text-sm border border-[#C6D5CA] rounded-lg focus:outline-none focus:ring-2 focus:ring-[#15803D]/30 focus:border-[#15803D]"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-[#3F5346] mb-1.5">Phone Number</label>
              <input
                type="tel"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="+91 98450 00000"
                className="w-full px-3.5 py-2.5 text-sm border border-[#C6D5CA] rounded-lg focus:outline-none focus:ring-2 focus:ring-[#15803D]/30 focus:border-[#15803D]"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-[#3F5346] mb-1.5">
                Optional Location Signal
              </label>
              <button
                type="button"
                onClick={handleLocateMe}
                className="w-full inline-flex items-center justify-center gap-2 px-3.5 py-2.5 text-sm font-medium text-[#0D2818] bg-[#F2F7F3] hover:bg-[#E4EFE7] border border-[#C6D5CA] rounded-lg transition-colors cursor-pointer"
              >
                <MapPin className="w-4 h-4 text-[#15803D]" />
                Use Device Location (Optional)
              </button>
            </div>
          </div>

          {locStatus && <p className="text-xs text-[#4D6154]">{locStatus}</p>}

          <div>
            <label className="block text-xs font-medium text-[#3F5346] mb-1.5">Street Address</label>
            <input
              type="text"
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              placeholder="Shop no., street, landmark"
              className="w-full px-3.5 py-2.5 text-sm border border-[#C6D5CA] rounded-lg focus:outline-none focus:ring-2 focus:ring-[#15803D]/30 focus:border-[#15803D]"
            />
          </div>

          <label className="flex items-start gap-3 p-4 rounded-xl bg-[#F4F9F5] border border-[#DCE6DF] cursor-pointer">
            <input
              type="checkbox"
              checked={seedSample}
              onChange={(e) => setSeedSample(e.target.checked)}
              className="mt-1 h-4 w-4 accent-[#15803D]"
            />
            <div>
              <span className="block text-sm font-semibold text-[#0D2818]">
                Pre-load clearly labelled Sample Kirana Store dataset (recommended for evaluation)
              </span>
              <span className="block text-xs text-[#4D6154] mt-0.5">
                Populates 15 staples, 12 expiry-tracked batches, 4 suppliers, and 30 days of historical sales so forecasting, reorder math, and reports work immediately. Uncheck to start with a blank catalog.
              </span>
            </div>
          </label>

          <div className="pt-2 flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-4 text-xs">
              <button
                type="button"
                onClick={enterDemoMode}
                className="text-[#15803D] hover:underline font-medium cursor-pointer"
              >
                Browse Sandbox Demo Instead
              </button>
              <button
                type="button"
                onClick={signOutUser}
                className="text-[#54695B] hover:text-[#111D15] cursor-pointer"
              >
                Sign Out
              </button>
            </div>

            <button
              type="submit"
              disabled={submitting}
              className="px-6 py-2.5 text-sm font-semibold text-white bg-[#15803D] hover:bg-[#166534] rounded-lg transition-colors whitespace-nowrap cursor-pointer disabled:opacity-60"
            >
              {submitting ? 'Creating Shop...' : 'Create Shop & Continue'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
