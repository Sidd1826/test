import React, { useState, useEffect } from 'react';
import { Download, FileSpreadsheet, RefreshCw, Calendar, Database, AlertCircle, CheckCircle, Loader2, X, LogOut, User } from 'lucide-react';
import { PublicClientApplication } from '@azure/msal-browser';
import { MsalProvider, useMsal, useIsAuthenticated } from '@azure/msal-react';

// MSAL Configuration
const msalConfig = {
  auth: {
    clientId: 'YOUR_CLIENT_ID', // Replace with your Azure AD App Client ID
    authority: 'https://login.microsoftonline.com/YOUR_TENANT_ID', // Replace with your Tenant ID
    redirectUri: window.location.origin,
  },
  cache: {
    cacheLocation: 'localStorage',
    storeAuthStateInCookie: false,
  },
};

const loginRequest = {
  scopes: ['User.Read'],
};

const msalInstance = new PublicClientApplication(msalConfig);

// API Service
const apiService = {
  baseUrl: 'http://localhost:5000',
  
  async fetchFRICount(date, token) {
    const response = await fetch(`${this.baseUrl}/fri/count`, {
      method: 'POST',
      headers: { 
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({ date })
    });
    
    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || 'Failed to fetch count');
    }
    
    const data = await response.json();
    return data.count || data.total_count || 0;
  },
  
  async generateFRIExcel(date, token) {
    const response = await fetch(`${this.baseUrl}/fri/data/excel`, {
      method: 'POST',
      headers: { 
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({ date })
    });
    
    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || 'Failed to generate Excel');
    }
    
    const blob = await response.blob();
    const fileName = `fri_data_${date}_${Date.now()}.xlsx`;
    return { blob, fileName };
  },
  
  async fetchMNRLCount(date, type, token) {
    const response = await fetch(`${this.baseUrl}/mnrl/count`, {
      method: 'POST',
      headers: { 
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({ date, type })
    });
    
    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || 'Failed to fetch count');
    }
    
    const data = await response.json();
    return data.count || data.total_count || 0;
  },
  
  async generateMNRLExcel(date, type, token) {
    const response = await fetch(`${this.baseUrl}/mnrl/data/excel`, {
      method: 'POST',
      headers: { 
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({ date, type })
    });
    
    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || 'Failed to generate Excel');
    }
    
    const blob = await response.blob();
    const fileName = `mnrl_${type}_${date}_${Date.now()}.xlsx`;
    return { blob, fileName };
  },
  
  async saveToDataverse(fileName, fileBlob, recordCount, date, module, token, dataType = null) {
    const formData = new FormData();
    formData.append('file', fileBlob, fileName);
    formData.append('record_count', recordCount);
    formData.append('export_date', date);
    formData.append('module', module);
    if (dataType) formData.append('data_type', dataType);
    
    const response = await fetch(`${this.baseUrl}/dataverse/save`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`
      },
      body: formData
    });
    
    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || 'Failed to save to Dataverse');
    }
    
    return await response.json();
  },
  
  async listFiles(module, token) {
    const response = await fetch(`${this.baseUrl}/dataverse/list?module=${module}`, {
      headers: {
        'Authorization': `Bearer ${token}`
      }
    });
    if (!response.ok) throw new Error('Failed to load files');
    const data = await response.json();
    return data.data || data || [];
  },
  
  async downloadFile(fileId, token) {
    const response = await fetch(`${this.baseUrl}/dataverse/download/${fileId}`, {
      headers: {
        'Authorization': `Bearer ${token}`
      }
    });
    if (!response.ok) throw new Error('Failed to download file');
    return await response.blob();
  }
};

// Alert Component
const Alert = ({ type, message, onClose }) => {
  const styles = {
    success: {
      bg: 'bg-green-50',
      border: 'border-green-500',
      text: 'text-green-800',
      icon: <CheckCircle className="w-5 h-5 text-green-600" />
    },
    error: {
      bg: 'bg-red-50',
      border: 'border-red-500',
      text: 'text-red-800',
      icon: <AlertCircle className="w-5 h-5 text-red-600" />
    },
    warning: {
      bg: 'bg-amber-50',
      border: 'border-amber-500',
      text: 'text-amber-800',
      icon: <AlertCircle className="w-5 h-5 text-amber-600" />
    }
  };
  
  const style = styles[type] || styles.error;
  
  return (
    <div className={`mt-4 p-4 ${style.bg} border-l-4 ${style.border} rounded-lg flex items-start gap-3`}>
      {style.icon}
      <div className="flex-1">
        <p className={`${style.text} font-medium`}>{message}</p>
      </div>
      {onClose && (
        <button onClick={onClose} className={`${style.text} hover:opacity-70`}>
          <X className="w-4 h-4" />
        </button>
      )}
    </div>
  );
};

// Date Picker Component
const DatePicker = ({ selectedDate, onChange, label }) => (
  <div className="bg-gray-50 rounded-lg p-4">
    <label className="block text-sm font-medium text-gray-700 mb-2 flex items-center gap-2">
      <Calendar className="w-4 h-4" />
      {label}
    </label>
    <input
      type="date"
      value={selectedDate}
      onChange={(e) => onChange(e.target.value)}
      max={new Date().toISOString().split('T')[0]}
      className="w-full px-4 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-all"
    />
  </div>
);

// Stats Card Component
const StatsCard = ({ title, count, date, color = "blue" }) => {
  const colorClasses = {
    blue: 'from-blue-500 to-indigo-600',
    green: 'from-green-500 to-emerald-600',
    purple: 'from-purple-500 to-violet-600'
  };
  
  return (
    <div className={`bg-gradient-to-br ${colorClasses[color]} rounded-lg p-4 text-white`}>
      <div className="text-sm font-medium opacity-90 mb-1">{title}</div>
      <div className="text-3xl font-bold">
        {count !== null ? count.toLocaleString() : '---'}
      </div>
      <div className="text-xs opacity-75 mt-1">for {date}</div>
    </div>
  );
};

// Export Button Component
const ExportButton = ({ onClick, loading, disabled, label }) => (
  <button
    onClick={onClick}
    disabled={disabled || loading}
    className="w-full flex items-center justify-center gap-3 px-6 py-4 bg-gradient-to-r from-blue-600 to-indigo-600 text-white rounded-lg hover:from-blue-700 hover:to-indigo-700 disabled:from-gray-400 disabled:to-gray-400 disabled:cursor-not-allowed transition-all shadow-lg hover:shadow-xl font-semibold text-lg"
  >
    {loading ? (
      <>
        <Loader2 className="w-5 h-5 animate-spin" />
        Processing Export...
      </>
    ) : (
      <>
        <FileSpreadsheet className="w-5 h-5" />
        {label}
      </>
    )}
  </button>
);

// File Table Row Component
const FileTableRow = ({ file, onDownload, showDataType = false }) => (
  <tr className="hover:bg-blue-50 transition-colors">
    <td className="px-6 py-4">
      <button
        onClick={() => onDownload(file)}
        className="text-blue-600 hover:text-blue-800 font-medium text-left flex items-center gap-2 group"
      >
        <FileSpreadsheet className="w-5 h-5 group-hover:scale-110 transition-transform" />
        <span className="group-hover:underline">{file.name}</span>
      </button>
    </td>
    <td className="px-6 py-4 text-sm text-gray-700">
      {new Date(file.export_date).toLocaleDateString('en-US', { 
        year: 'numeric', 
        month: 'short', 
        day: 'numeric' 
      })}
    </td>
    {showDataType && (
      <td className="px-6 py-4">
        <span className={`px-3 py-1 rounded-full text-sm font-medium ${
          file.data_type === 'reactivated' 
            ? 'bg-purple-100 text-purple-700' 
            : 'bg-green-100 text-green-700'
        }`}>
          {file.data_type === 'reactivated' ? 'Reactivated' : 'Normal Data'}
        </span>
      </td>
    )}
    <td className="px-6 py-4">
      <span className="px-3 py-1 bg-blue-100 text-blue-700 rounded-full text-sm font-medium">
        {file.record_count?.toLocaleString() || 'N/A'}
      </span>
    </td>
    <td className="px-6 py-4 text-sm text-gray-600">
      {new Date(file.created_date).toLocaleString('en-US', {
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
      })}
    </td>
    <td className="px-6 py-4 text-center">
      <button
        onClick={() => onDownload(file)}
        className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors shadow-sm hover:shadow"
      >
        <Download className="w-4 h-4" />
        Download
      </button>
    </td>
  </tr>
);

// Files Table Component
const FilesTable = ({ files, loading, onDownload, showDataType = false }) => {
  if (loading) {
    return (
      <div className="text-center py-16">
        <Loader2 className="w-8 h-8 text-blue-600 animate-spin mx-auto mb-3" />
        <p className="text-gray-500">Loading files...</p>
      </div>
    );
  }
  
  if (files.length === 0) {
    return (
      <div className="text-center py-16">
        <div className="w-16 h-16 bg-gray-100 rounded-full flex items-center justify-center mx-auto mb-4">
          <FileSpreadsheet className="w-8 h-8 text-gray-400" />
        </div>
        <p className="text-gray-600 font-medium">No exported files yet</p>
        <p className="text-sm text-gray-400 mt-2">
          Select a date and click export to create your first export
        </p>
      </div>
    );
  }
  
  return (
    <div className="overflow-hidden border border-gray-200 rounded-lg">
      <table className="w-full">
        <thead className="bg-gradient-to-r from-gray-50 to-gray-100">
          <tr>
            <th className="px-6 py-4 text-left text-xs font-semibold text-gray-700 uppercase tracking-wider">
              File Name
            </th>
            <th className="px-6 py-4 text-left text-xs font-semibold text-gray-700 uppercase tracking-wider">
              Export Date
            </th>
            {showDataType && (
              <th className="px-6 py-4 text-left text-xs font-semibold text-gray-700 uppercase tracking-wider">
                Data Type
              </th>
            )}
            <th className="px-6 py-4 text-left text-xs font-semibold text-gray-700 uppercase tracking-wider">
              Records
            </th>
            <th className="px-6 py-4 text-left text-xs font-semibold text-gray-700 uppercase tracking-wider">
              Created
            </th>
            <th className="px-6 py-4 text-center text-xs font-semibold text-gray-700 uppercase tracking-wider">
              Action
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-200 bg-white">
          {files.map((file) => (
            <FileTableRow key={file.id} file={file} onDownload={onDownload} showDataType={showDataType} />
          ))}
        </tbody>
      </table>
    </div>
  );
};

// FRI Page Component
const FRIPage = ({ token }) => {
  const [savedFiles, setSavedFiles] = useState([]);
  const [recordCount, setRecordCount] = useState(null);
  const [loading, setLoading] = useState(false);
  const [loadingFiles, setLoadingFiles] = useState(true);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [selectedDate, setSelectedDate] = useState(new Date().toISOString().split('T')[0]);

  const loadSavedFiles = async () => {
    setLoadingFiles(true);
    try {
      const files = await apiService.listFiles('FRI', token);
      setSavedFiles(files);
    } catch (err) {
      setError('Failed to load saved files');
    } finally {
      setLoadingFiles(false);
    }
  };

  const handleExportData = async () => {
    setLoading(true);
    setError('');
    setSuccess('');
    
    try {
      const count = await apiService.fetchFRICount(selectedDate, token);
      setRecordCount(count);
      
      if (count === 0) {
        setError('No records found for the selected date');
        return;
      }
      
      const { blob, fileName } = await apiService.generateFRIExcel(selectedDate, token);
      
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = fileName;
      link.click();
      window.URL.revokeObjectURL(url);
      
      const savedFile = await apiService.saveToDataverse(fileName, blob, count, selectedDate, 'FRI', token);
      
      setSavedFiles(prev => [savedFile, ...prev]);
      setSuccess(`Successfully exported ${count.toLocaleString()} records for ${selectedDate}`);
      
    } catch (err) {
      setError(err.message || 'An error occurred during export');
    } finally {
      setLoading(false);
    }
  };

  const handleDateChange = async (date) => {
    setSelectedDate(date);
    setError('');
    setRecordCount(null);
    
    try {
      const count = await apiService.fetchFRICount(date, token);
      setRecordCount(count);
    } catch (err) {
      console.error('Failed to fetch count:', err);
    }
  };

  const handleDownloadSaved = async (file) => {
    try {
      const blob = await apiService.downloadFile(file.id, token);
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = file.name;
      link.click();
      window.URL.revokeObjectURL(url);
    } catch (err) {
      setError('Failed to download file');
    }
  };

  useEffect(() => {
    if (token) {
      loadSavedFiles();
    }
  }, [token]);

  useEffect(() => {
    if (success) {
      const timer = setTimeout(() => setSuccess(''), 5000);
      return () => clearTimeout(timer);
    }
  }, [success]);

  return (
    <div>
      <div className="bg-white rounded-xl shadow-lg p-8 mb-6">
        <div className="flex items-center gap-3 mb-6">
          <div className="p-3 bg-blue-100 rounded-lg">
            <Database className="w-6 h-6 text-blue-600" />
          </div>
          <div>
            <h1 className="text-3xl font-bold text-gray-800">FRI Data Export</h1>
            <p className="text-gray-600 text-sm mt-1">
              Export daily FRI records and manage your data archive
            </p>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-6">
          <DatePicker 
            selectedDate={selectedDate} 
            onChange={handleDateChange}
            label="Select Export Date"
          />
          <StatsCard title="Records Available" count={recordCount} date={selectedDate} color="blue" />
        </div>

        <ExportButton 
          onClick={handleExportData}
          loading={loading}
          disabled={recordCount === 0}
          label="Export FRI Data to Excel & Save"
        />

        {recordCount === 0 && (
          <Alert type="warning" message="No records available for this date" />
        )}
        
        {success && <Alert type="success" message={success} onClose={() => setSuccess('')} />}
        {error && <Alert type="error" message={error} onClose={() => setError('')} />}
      </div>

      <div className="bg-white rounded-xl shadow-lg p-6">
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-3">
            <FileSpreadsheet className="w-6 h-6 text-blue-600" />
            <h2 className="text-xl font-bold text-gray-800">FRI Exported Files</h2>
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={loadSavedFiles}
              disabled={loadingFiles}
              className="flex items-center gap-2 px-4 py-2 text-sm text-blue-600 hover:bg-blue-50 rounded-lg transition-colors"
            >
              <RefreshCw className={`w-4 h-4 ${loadingFiles ? 'animate-spin' : ''}`} />
              Refresh
            </button>
            <span className="px-3 py-1 bg-blue-100 text-blue-700 rounded-full text-sm font-medium">
              {savedFiles.length} files
            </span>
          </div>
        </div>
        
        <FilesTable 
          files={savedFiles}
          loading={loadingFiles}
          onDownload={handleDownloadSaved}
        />
      </div>
    </div>
  );
};

// MNRL Page Component
const MNRLPage = ({ token }) => {
  const [savedFiles, setSavedFiles] = useState([]);
  const [normalCount, setNormalCount] = useState(null);
  const [reactivatedCount, setReactivatedCount] = useState(null);
  const [loading, setLoading] = useState(false);
  const [loadingFiles, setLoadingFiles] = useState(true);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [selectedDate, setSelectedDate] = useState(new Date().toISOString().split('T')[0]);

  const loadSavedFiles = async () => {
    setLoadingFiles(true);
    try {
      const files = await apiService.listFiles('MNRL', token);
      setSavedFiles(files);
    } catch (err) {
      setError('Failed to load saved files');
    } finally {
      setLoadingFiles(false);
    }
  };

  const handleExportData = async (type) => {
    setLoading(true);
    setError('');
    setSuccess('');
    
    try {
      const count = await apiService.fetchMNRLCount(selectedDate, type, token);
      
      if (count === 0) {
        setError(`No ${type} records found for the selected date`);
        return;
      }
      
      const { blob, fileName } = await apiService.generateMNRLExcel(selectedDate, type, token);
      
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = fileName;
      link.click();
      window.URL.revokeObjectURL(url);
      
      const savedFile = await apiService.saveToDataverse(fileName, blob, count, selectedDate, 'MNRL', token, type);
      
      setSavedFiles(prev => [savedFile, ...prev]);
      setSuccess(`Successfully exported ${count.toLocaleString()} ${type} records for ${selectedDate}`);
      
    } catch (err) {
      setError(err.message || 'An error occurred during export');
    } finally {
      setLoading(false);
    }
  };

  const handleDateChange = async (date) => {
    setSelectedDate(date);
    setError('');
    setNormalCount(null);
    setReactivatedCount(null);
    
    try {
      const [normal, reactivated] = await Promise.all([
        apiService.fetchMNRLCount(date, 'normal', token),
        apiService.fetchMNRLCount(date, 'reactivated', token)
      ]);
      setNormalCount(normal);
      setReactivatedCount(reactivated);
    } catch (err) {
      console.error('Failed to fetch counts:', err);
    }
  };

  const handleDownloadSaved = async (file) => {
    try {
      const blob = await apiService.downloadFile(file.id, token);
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = file.name;
      link.click();
      window.URL.revokeObjectURL(url);
    } catch (err) {
      setError('Failed to download file');
    }
  };

  useEffect(() => {
    if (token) {
      loadSavedFiles();
    }
  }, [token]);

  useEffect(() => {
    if (success) {
      const timer = setTimeout(() => setSuccess(''), 5000);
      return () => clearTimeout(timer);
    }
  }, [success]);

  return (
    <div>
      <div className="bg-white rounded-xl shadow-lg p-8 mb-6">
        <div className="flex items-center gap-3 mb-6">
          <div className="p-3 bg-purple-100 rounded-lg">
            <Database className="w-6 h-6 text-purple-600" />
          </div>
          <div>
            <h1 className="text-3xl font-bold text-gray-800">MNRL Data Export</h1>
            <p className="text-gray-600 text-sm mt-1">
              Export normal and reactivated MNRL data separately
            </p>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-6">
          <DatePicker 
            selectedDate={selectedDate} 
            onChange={handleDateChange}
            label="Select Export Date"
          />
          <StatsCard title="Normal Data Records" count={normalCount} date={selectedDate} color="green" />
          <StatsCard title="Reactivated Records" count={reactivatedCount} date={selectedDate} color="purple" />
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <ExportButton 
            onClick={() => handleExportData('normal')}
            loading={loading}
            disabled={normalCount === 0}
            label="Export Normal Data"
          />
          <ExportButton 
            onClick={() => handleExportData('reactivated')}
            loading={loading}
            disabled={reactivatedCount === 0}
            label="Export Reactivated Data"
          />
        </div>

        {normalCount === 0 && reactivatedCount === 0 && (
          <Alert type="warning" message="No records available for this date" />
        )}
        
        {success && <Alert type="success" message={success} onClose={() => setSuccess('')} />}
        {error && <Alert type="error" message={error} onClose={() => setError('')} />}
      </div>

      <div className="bg-white rounded-xl shadow-lg p-6">
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-3">
            <FileSpreadsheet className="w-6 h-6 text-purple-600" />
            <h2 className="text-xl font-bold text-gray-800">MNRL Exported Files</h2>
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={loadSavedFiles}
              disabled={loadingFiles}
              className="flex items-center gap-2 px-4 py-2 text-sm text-purple-600 hover:bg-purple-50 rounded-lg transition-colors"
            >
              <RefreshCw className={`w-4 h-4 ${loadingFiles ? 'animate-spin' : ''}`} />
              Refresh
            </button>
            <span className="px-3 py-1 bg-purple-100 text-purple-700 rounded-full text-sm font-medium">
              {savedFiles.length} files
            </span>
          </div>
        </div>
        
        <FilesTable 
          files={savedFiles}
          loading={loadingFiles}
          onDownload={handleDownloadSaved}
          showDataType={true}
        />
      </div>
    </div>
  );
};

// Navigation Component
const Navigation = ({ currentRoute, onNavigate, userName, onLogout }) => {
  return (
    <nav className="bg-white shadow-md sticky top-0 z-10">
      <div className="max-w-6xl mx-auto px-6 py-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <h1 className="text-2xl font-bold text-gray-800">Data Export Manager</h1>
            <div className="flex gap-2">
              <button
                onClick={() => onNavigate('/fri')}
                className={`px-6 py-2 rounded-lg font-medium transition-all ${
                  currentRoute === '/fri'
                    ? 'bg-blue-600 text-white shadow-md'
                    : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                }`}
              >
                FRI
              </button>
              <button
                onClick={() => onNavigate('/mnrl')}
                className={`px-6 py-2 rounded-lg font-medium transition-all ${
                  currentRoute === '/mnrl'
                    ? 'bg-purple-600 text-white shadow-md'
                    : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                }`}
              >
                MNRL
              </button>
            </div>
          </div>
          
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2 px-4 py-2 bg-gray-100 rounded-lg">
              <User className="w-5 h-5 text-gray-600" />
              <span className="font-medium text-gray-800">{userName}</span>
            </div>
            <button
              onClick={onLogout}
              className="flex items-center gap-2 px-4 py-2 bg-red-100 text-red-700 rounded-lg hover:bg-red-200 transition-colors"
            >
              <LogOut className="w-4 h-4" />
              Logout
            </button>
          </div>
        </div>
      </div>
    </nav>
  );
};

// ...existing code...

// Login Page Component
const LoginPage = ({ onLogin }) => {
  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 flex items-center justify-center p-6">
      <div className="bg-white rounded-2xl shadow-2xl p-12 max-w-md w-full">
        <div className="text-center mb-8">
          <div className="w-20 h-20 bg-blue-100 rounded-full flex items-center justify-center mx-auto mb-4">
            <Database className="w-10 h-10 text-blue-600" />
          </div>
          <h1 className="text-3xl font-bold text-gray-800 mb-2">
            Data Export Manager
          </h1>
          <p className="text-gray-600">
            Sign in with your Microsoft account
          </p>
        </div>
        
        <button
          onClick={onLogin}
          className="w-full px-6 py-3 bg-gradient-to-r from-blue-600 to-indigo-600 text-white rounded-lg hover:from-blue-700 hover:to-indigo-700 transition-all shadow-lg hover:shadow-xl font-semibold text-lg"
        >
          Sign in with Microsoft
        </button>
      </div>
    </div>
  );
};

// Main App Component
const AppContent = () => {
  const { accounts } = useMsal();
  const isAuthenticated = useIsAuthenticated();
  const [currentRoute, setCurrentRoute] = useState('/fri');
  const [token, setToken] = useState(null);

  const handleLogin = async () => {
    try {
      const response = await msalInstance.loginPopup(loginRequest);
      setToken(response.accessToken);
    } catch (error) {
      console.error('Login failed:', error);
    }
  };

  const handleLogout = () => {
    msalInstance.logout();
    setToken(null);
    setCurrentRoute('/fri');
  };

  const acquireToken = async () => {
    try {
      const response = await msalInstance.acquireTokenSilent({
        scopes: loginRequest.scopes,
        account: accounts[0]
      });
      setToken(response.accessToken);
    } catch (error) {
      console.error('Token acquisition failed:', error);
    }
  };

  useEffect(() => {
    if (isAuthenticated && accounts.length > 0) {
      acquireToken();
    }
  }, [isAuthenticated, accounts]);

  if (!isAuthenticated) {
    return <LoginPage onLogin={handleLogin} />;
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <Navigation 
        currentRoute={currentRoute} 
        onNavigate={setCurrentRoute}
        userName={accounts[0]?.name || 'User'}
        onLogout={handleLogout}
      />
      
      <main className="max-w-6xl mx-auto px-6 py-8">
        {currentRoute === '/fri' && <FRIPage token={token} />}
        {currentRoute === '/mnrl' && <MNRLPage token={token} />}
      </main>
    </div>
  );
};

// Root App Component
export default function App() {
  return (
    <MsalProvider instance={msalInstance}>
      <AppContent />
    </MsalProvider>
  );
}